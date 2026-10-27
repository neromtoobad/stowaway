// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity 0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Stowaway: USDC on Arc for shielded ZEC, with no bridge and no unshielding.
/// @notice A maker locks USDC and asks for ZEC at a one-time shielded address. A taker reserves
/// the order, pays the ZEC inside the shielded pool, and claims the USDC with a quorum of Watch
/// attestations. Each attestation says one Zcash output paid the order's address, enough ZEC,
/// with the order's memo. The Watch checks a single-output disclosure (a chit) and never holds a
/// viewing key. This chain never sees the Zcash address: only its hash, and a copy sealed to
/// each Watch key.
contract Stowaway {
    enum State {
        None,
        Open,
        Reserved,
        Settled,
        Cancelled
    }

    struct Order {
        address maker;
        uint96 usdc; // 6 decimals
        uint64 zats; // ZEC wanted, in zatoshis
        uint64 expiry;
        address taker; // set while reserved; receives the USDC
        uint64 lockUntil;
        State state;
        bytes32 addrHash; // keccak256 of the maker's one-time Zcash address
    }

    /// One Zcash output, as checked by a Watch. The Watch signs this, nothing more.
    struct Claim {
        uint256 id;
        bytes32 txid; // Zcash txid, display byte order
        uint32 action; // output index inside the shielded bundle
        uint64 zats; // value of that output
        bytes32 addrHash; // keccak256 of the address the output paid
        address taker; // payout address named in the memo
        bytes32 chitHash; // keccak256 of the disclosure the Watch checked
    }

    uint64 public constant LOCK = 60 minutes;
    uint8 public constant QUORUM = 2;

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(uint256 id,bytes32 txid,uint32 action,uint64 zats,bytes32 addrHash,address taker,bytes32 chitHash)"
    );

    IERC20 public immutable usdc;
    address public immutable watch0;
    address public immutable watch1;
    address public immutable watch2;
    bytes32 public immutable DOMAIN_SEPARATOR;

    uint256 public nextId = 1;
    mapping(uint256 => Order) public orders;
    mapping(bytes32 => bool) public addrUsed; // one-time addresses only
    mapping(bytes32 => bool) public outputUsed; // keccak256(txid, action): one output settles one order

    event Posted(
        uint256 indexed id, address indexed maker, uint96 usdc, uint64 zats, uint64 expiry, bytes32 addrHash, bytes envelope
    );
    event Reserved(uint256 indexed id, address indexed taker, uint64 lockUntil);
    event Settled(uint256 indexed id, address indexed taker, bytes32 txid, uint32 action, bytes32 chitHash);
    event Cancelled(uint256 indexed id);

    error BadOrder();
    error AddressReused();
    error NotOpen();
    error Locked();
    error Expired();
    error NotMaker();
    error Mismatch();
    error OutputSpent();
    error NoQuorum();
    error TransferFailed();

    constructor(IERC20 usdc_, address[3] memory watch_) {
        require(watch_[0] != address(0) && watch_[1] != address(0) && watch_[2] != address(0), "watch");
        require(watch_[0] != watch_[1] && watch_[0] != watch_[2] && watch_[1] != watch_[2], "watch");
        usdc = usdc_;
        (watch0, watch1, watch2) = (watch_[0], watch_[1], watch_[2]);
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Stowaway"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Lock USDC and ask for `zats` at a one-time Zcash address. `envelope` carries that
    /// address encrypted to each Watch key; only its hash is public.
    function post(uint96 amount, uint64 zats, uint64 expiry, bytes32 addrHash, bytes calldata envelope)
        external
        returns (uint256 id)
    {
        if (amount == 0 || zats == 0 || addrHash == bytes32(0) || envelope.length == 0) revert BadOrder();
        if (expiry < block.timestamp + 2 * LOCK) revert BadOrder();
        if (addrUsed[addrHash]) revert AddressReused();
        addrUsed[addrHash] = true;
        id = nextId++;
        orders[id] = Order(msg.sender, amount, zats, expiry, address(0), 0, State.Open, addrHash);
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Posted(id, msg.sender, amount, zats, expiry, addrHash, envelope);
    }

    /// @notice Hold an order for `taker` for one hour while they pay the ZEC. Anyone may call it
    /// (the Watch relays it, so a taker needs no gas). A lapsed hold can be taken over.
    function reserve(uint256 id, address taker) external {
        Order storage o = orders[id];
        if (taker == address(0)) revert BadOrder();
        if (o.state == State.Reserved) {
            if (block.timestamp <= o.lockUntil) revert Locked();
        } else if (o.state != State.Open) {
            revert NotOpen();
        }
        if (block.timestamp + LOCK > o.expiry) revert Expired();
        o.taker = taker;
        o.lockUntil = uint64(block.timestamp + LOCK);
        o.state = State.Reserved;
        emit Reserved(id, taker, o.lockUntil);
    }

    /// @notice Release the USDC to the taker named in the claim, given QUORUM distinct Watch
    /// signatures. Anyone may submit it.
    function settle(Claim calldata c, bytes[] calldata sigs) external {
        Order storage o = orders[c.id];
        if (o.state != State.Reserved) revert NotOpen();
        if (c.taker != o.taker || c.addrHash != o.addrHash || c.zats < o.zats) revert Mismatch();
        bytes32 out = keccak256(abi.encodePacked(c.txid, c.action));
        if (outputUsed[out]) revert OutputSpent();
        if (attestations(c, sigs) < QUORUM) revert NoQuorum();
        outputUsed[out] = true;
        o.state = State.Settled;
        if (!usdc.transfer(c.taker, o.usdc)) revert TransferFailed();
        emit Settled(c.id, c.taker, c.txid, c.action, c.chitHash);
    }

    /// @notice The maker takes the USDC back from an open order, or from a hold that lapsed.
    function cancel(uint256 id) external {
        Order storage o = orders[id];
        if (msg.sender != o.maker) revert NotMaker();
        if (o.state == State.Reserved) {
            if (block.timestamp <= o.lockUntil) revert Locked();
        } else if (o.state != State.Open) {
            revert NotOpen();
        }
        o.state = State.Cancelled;
        if (!usdc.transfer(o.maker, o.usdc)) revert TransferFailed();
        emit Cancelled(id);
    }

    function digest(Claim calldata c) public view returns (bytes32) {
        bytes32 h =
            keccak256(abi.encode(CLAIM_TYPEHASH, c.id, c.txid, c.action, c.zats, c.addrHash, c.taker, c.chitHash));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, h));
    }

    /// Distinct Watch keys that signed this claim.
    function attestations(Claim calldata c, bytes[] calldata sigs) public view returns (uint8 n) {
        bytes32 d = digest(c);
        bool[3] memory seen;
        for (uint256 i = 0; i < sigs.length; i++) {
            address s = recover(d, sigs[i]);
            uint256 k = s == watch0 ? 0 : s == watch1 ? 1 : s == watch2 ? 2 : 3;
            if (k < 3 && !seen[k]) {
                seen[k] = true;
                n++;
            }
        }
    }

    function watches() external view returns (address[3] memory) {
        return [watch0, watch1, watch2];
    }

    function recover(bytes32 d, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        // Reject high-s signatures (malleable copies).
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(d, v, r, s);
    }
}
