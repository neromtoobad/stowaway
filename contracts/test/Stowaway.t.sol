// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {Stowaway, IERC20} from "../src/Stowaway.sol";

contract TestUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

contract StowawayTest is Test {
    TestUSDC usdc;
    Stowaway sw;
    uint256[3] wk = [uint256(0xA11), 0xB22, 0xC33];
    address maker = address(0xBEEF);
    address taker = address(0xCAFE);
    bytes32 addrHash = keccak256("utest1onetime");

    function setUp() public {
        usdc = new TestUSDC();
        sw = new Stowaway(IERC20(address(usdc)), [vm.addr(wk[0]), vm.addr(wk[1]), vm.addr(wk[2])]);
        usdc.mint(maker, 100e6);
        vm.prank(maker);
        usdc.approve(address(sw), type(uint256).max);
    }

    function post() internal returns (uint256) {
        vm.prank(maker);
        return sw.post(10e6, 25_000_000, uint64(block.timestamp + 1 days), addrHash, hex"01");
    }

    function claim(uint256 id) internal view returns (Stowaway.Claim memory) {
        return Stowaway.Claim(id, keccak256("tx"), 0, 25_000_000, addrHash, taker, keccak256("chit"));
    }

    function sign(uint256 k, Stowaway.Claim memory c) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(k, sw.digest(c));
        return abi.encodePacked(r, s, v);
    }

    function sigs2(Stowaway.Claim memory c) internal view returns (bytes[] memory s) {
        s = new bytes[](2);
        s[0] = sign(wk[0], c);
        s[1] = sign(wk[2], c);
    }

    function testHappyPath() public {
        uint256 id = post();
        assertEq(usdc.balanceOf(address(sw)), 10e6);
        sw.reserve(id, taker);
        Stowaway.Claim memory c = claim(id);
        sw.settle(c, sigs2(c));
        assertEq(usdc.balanceOf(taker), 10e6);
        (,,,,,, Stowaway.State st,) = sw.orders(id);
        assertEq(uint8(st), uint8(Stowaway.State.Settled));
    }

    function testOneSignatureIsNotEnough() public {
        uint256 id = post();
        sw.reserve(id, taker);
        Stowaway.Claim memory c = claim(id);
        bytes[] memory s = new bytes[](2);
        s[0] = sign(wk[1], c);
        s[1] = sign(wk[1], c); // same Watch twice
        vm.expectRevert(Stowaway.NoQuorum.selector);
        sw.settle(c, s);
    }

    function testStrangerSignaturesDoNotCount() public {
        uint256 id = post();
        sw.reserve(id, taker);
        Stowaway.Claim memory c = claim(id);
        bytes[] memory s = new bytes[](2);
        s[0] = sign(wk[0], c);
        s[1] = sign(0xD44, c);
        vm.expectRevert(Stowaway.NoQuorum.selector);
        sw.settle(c, s);
    }

    function testClaimMustMatchOrder() public {
        uint256 id = post();
        sw.reserve(id, taker);
        Stowaway.Claim memory c = claim(id);
        c.zats = 24_999_999; // short payment
        bytes[] memory s = sigs2(c);
        vm.expectRevert(Stowaway.Mismatch.selector);
        sw.settle(c, s);
        c = claim(id);
        c.addrHash = keccak256("someone else");
        s = sigs2(c);
        vm.expectRevert(Stowaway.Mismatch.selector);
        sw.settle(c, s);
        c = claim(id);
        c.taker = address(0xBAD);
        s = sigs2(c);
        vm.expectRevert(Stowaway.Mismatch.selector);
        sw.settle(c, s);
    }

    function testSignaturesBindEveryField() public {
        uint256 id = post();
        sw.reserve(id, taker);
        Stowaway.Claim memory c = claim(id);
        bytes[] memory s = sigs2(c);
        c.chitHash = keccak256("other chit");
        vm.expectRevert(Stowaway.NoQuorum.selector);
        sw.settle(c, s);
    }

    function testOneOutputSettlesOneOrder() public {
        uint256 a = post();
        vm.prank(maker);
        uint256 b = sw.post(10e6, 25_000_000, uint64(block.timestamp + 1 days), keccak256("utest1other"), hex"01");
        sw.reserve(a, taker);
        sw.reserve(b, taker);
        Stowaway.Claim memory c = claim(a);
        sw.settle(c, sigs2(c));
        Stowaway.Claim memory c2 = claim(b);
        c2.addrHash = keccak256("utest1other");
        bytes[] memory s = sigs2(c2);
        vm.expectRevert(Stowaway.OutputSpent.selector);
        sw.settle(c2, s);
    }

    function testAddressesAreOneTime() public {
        post();
        vm.prank(maker);
        vm.expectRevert(Stowaway.AddressReused.selector);
        sw.post(1e6, 1, uint64(block.timestamp + 1 days), addrHash, hex"01");
    }

    function testHoldBlocksOthersUntilItLapses() public {
        uint256 id = post();
        sw.reserve(id, taker);
        vm.expectRevert(Stowaway.Locked.selector);
        sw.reserve(id, address(0xD00D));
        vm.prank(maker);
        vm.expectRevert(Stowaway.Locked.selector);
        sw.cancel(id);
        vm.warp(block.timestamp + 61 minutes);
        sw.reserve(id, address(0xD00D));
        Stowaway.Claim memory c = claim(id); // the first taker paid too late
        bytes[] memory s = sigs2(c);
        vm.expectRevert(Stowaway.Mismatch.selector);
        sw.settle(c, s);
    }

    function testMakerCancels() public {
        uint256 id = post();
        vm.prank(address(0xBAD));
        vm.expectRevert(Stowaway.NotMaker.selector);
        sw.cancel(id);
        vm.prank(maker);
        sw.cancel(id);
        assertEq(usdc.balanceOf(maker), 100e6);
        vm.expectRevert(Stowaway.NotOpen.selector);
        sw.reserve(id, taker);
    }

    function testNoHoldNearExpiry() public {
        uint256 id = post();
        vm.warp(block.timestamp + 1 days - 30 minutes);
        vm.expectRevert(Stowaway.Expired.selector);
        sw.reserve(id, taker);
    }

    function testUnreservedOrderCannotSettle() public {
        uint256 id = post();
        Stowaway.Claim memory c = claim(id);
        bytes[] memory s = sigs2(c);
        vm.expectRevert(Stowaway.NotOpen.selector);
        sw.settle(c, s);
    }
}
