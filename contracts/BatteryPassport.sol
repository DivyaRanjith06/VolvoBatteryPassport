// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/**
 * @title  BatteryPassport
 * @notice Educational prototype of a blockchain-based EV Battery Passport,
 *         inspired by the Volvo Cars–Circulor supply-chain traceability case study.
 *
 * @dev    ACADEMIC DISCLAIMER – TWO IMPORTANT LIMITATIONS:
 *
 *         1. ACCESS CONTROL vs. DATA CONFIDENTIALITY
 *            Role checks in this contract prevent unauthorised addresses from
 *            calling restricted functions. They do NOT encrypt or hide storage.
 *            Anyone with direct node access can read all contract state regardless
 *            of role. A production system (e.g. Hyperledger Fabric, Circulor's
 *            platform) enforces access at the network layer, not just at the
 *            application layer.
 *
 *         2. DATA ACCURACY
 *            Blockchain guarantees that a record cannot be changed once written.
 *            It cannot verify that the submitted data was accurate at the time of
 *            entry. Carbon footprint figures, recycled-content percentages, and
 *            material-origin strings are self-reported by the participant who calls
 *            the function. External audits are required to verify accuracy.
 */
contract BatteryPassport {

    // =========================================================================
    // Roles
    // =========================================================================

    /**
     * @notice Participant roles in the supply chain.
     * @dev    None is the default (uint8 value 0). The Customer role is defined
     *         for completeness; getPublicPassport is callable by anyone and does
     *         not require the Customer role to be assigned.
     */
    enum Role {
        None,         // 0 – no role; default for every address
        Admin,        // 1 – deploys contract, manages all roles
        Supplier,     // 2 – records mining, refining, end-of-life, recycling
        Manufacturer, // 3 – records manufacturing and distribution
        Regulator,    // 4 – read-only full audit access
        Customer      // 5 – read-only public passport access (role optional)
    }

    /// @dev Address → assigned Role
    mapping(address => Role) private _roles;

    // =========================================================================
    // Lifecycle Stages
    // =========================================================================

    /**
     * @notice Battery lifecycle stages in mandatory sequential order.
     * @dev    Unregistered (0) is the default for any key not yet in _batteries.
     *         Each write function enforces that the preceding stage is complete.
     */
    enum Stage {
        Unregistered, // 0 – not yet on chain
        Registered,   // 1 – mining / raw-material extraction recorded
        Refined,      // 2 – refining and processing recorded
        Manufactured, // 3 – cell manufacturing and vehicle assembly recorded
        Distributed,  // 4 – distribution and delivery recorded
        EndOfLife,    // 5 – end-of-life collection recorded
        Recycled      // 6 – recycling and material recovery recorded
    }

    // =========================================================================
    // Data Structures
    // =========================================================================

    /**
     * @notice Complete battery record stored on chain.
     * @dev    Sensitive supplier names and financial data are intentionally
     *         excluded. Only operational/traceability fields are stored.
     */
    struct Battery {
        // --- Mining / Registration ---
        string  batchId;         // unique batch identifier, e.g. "BATCH-2024-001"
        string  mineLocation;    // geographic origin, e.g. "Katanga, DRC"
        string  materialOrigin;  // comma-separated materials, e.g. "Cobalt, Lithium"
        uint256 registeredAt;    // block.timestamp of registration
        address registeredBy;    // supplier address that registered this batch

        // --- Refining ---
        string refiningDetails;    // description of the refining process
        uint8  recycledContentPct; // percentage of recycled material used (0–100)

        // --- Manufacturing ---
        string  manufacturingDetails; // assembly process description
        uint256 carbonFootprintKg;    // self-reported CO2-equivalent in kg
        string  vehicleVIN;           // Vehicle Identification Number
        bool    qualityPassed;        // result of quality inspection

        // --- Distribution ---
        string distributionDetails; // shipment and delivery description

        // --- Recycling ---
        string recoveredMaterials; // materials recovered at end of life

        // --- Lifecycle ---
        Stage currentStage;
    }

    /**
     * @notice Subset of Battery returned by the public passport function.
     * @dev    Excludes registeredBy (wallet address) and refiningDetails
     *         (internal supplier data). All other fields are suitable for
     *         public disclosure via a QR-code-linked passport page.
     */
    struct PublicPassport {
        string  batchId;
        string  mineLocation;
        string  materialOrigin;
        uint8   recycledContentPct;
        uint256 carbonFootprintKg;
        string  manufacturingDetails;
        string  vehicleVIN;
        bool    qualityPassed;
        string  distributionDetails;
        string  recoveredMaterials;
        Stage   currentStage;
    }

    /// @dev batchId string → Battery record
    mapping(string => Battery) private _batteries;

    /// @dev Ordered list of all registered batch IDs (for regulator enumeration)
    string[] private _batchIds;

    // =========================================================================
    // Events
    // =========================================================================

    /// @notice Emitted when an address is assigned a role.
    event RoleGranted(address indexed account, Role role, address indexed grantedBy);

    /// @notice Emitted when a role is removed from an address.
    event RoleRevoked(address indexed account, address indexed revokedBy);

    /// @notice Emitted when a new battery batch is registered (Stage: Registered).
    event BatteryRegistered(
        string indexed batchId,
        string mineLocation,
        string materialOrigin,
        address indexed registeredBy,
        uint256 timestamp
    );

    /// @notice Emitted every time a battery's lifecycle stage advances.
    event StageAdvanced(
        string indexed batchId,
        Stage  newStage,
        address indexed advancedBy,
        uint256 timestamp
    );

    // =========================================================================
    // Constructor
    // =========================================================================

    /**
     * @notice Deploys the contract and assigns the Admin role to the deployer.
     */
    constructor() {
        _roles[msg.sender] = Role.Admin;
        emit RoleGranted(msg.sender, Role.Admin, msg.sender);
    }

    // =========================================================================
    // Modifiers
    // =========================================================================

    modifier onlyAdmin() {
        require(
            _roles[msg.sender] == Role.Admin,
            "Access denied: Admin role required"
        );
        _;
    }

    modifier onlySupplier() {
        require(
            _roles[msg.sender] == Role.Supplier,
            "Access denied: Supplier role required"
        );
        _;
    }

    modifier onlyManufacturer() {
        require(
            _roles[msg.sender] == Role.Manufacturer,
            "Access denied: Manufacturer role required"
        );
        _;
    }

    modifier onlyAdminOrRegulator() {
        require(
            _roles[msg.sender] == Role.Admin ||
            _roles[msg.sender] == Role.Regulator,
            "Access denied: Admin or Regulator role required"
        );
        _;
    }

    /**
     * @dev Reverts if the batch ID has not been registered yet.
     *      Uses Stage.Unregistered (the default mapping value) as the sentinel.
     */
    modifier batteryExists(string memory batchId) {
        require(
            _batteries[batchId].currentStage != Stage.Unregistered,
            "Battery not found: batch ID does not exist"
        );
        _;
    }

    /**
     * @dev Reverts if the battery's current stage does not match `expected`.
     *      This enforces the mandatory sequential lifecycle order.
     */
    modifier atStage(string memory batchId, Stage expected) {
        require(
            _batteries[batchId].currentStage == expected,
            "Stage order violated: prerequisite stage not yet complete"
        );
        _;
    }

    // =========================================================================
    // Role Management
    // =========================================================================

    /**
     * @notice Assign a role to an address. Only the Admin may call this.
     * @param  account  The address to assign the role to.
     * @param  role     The role to assign. Must not be None (use revokeRole instead).
     */
    function grantRole(address account, Role role) external onlyAdmin {
        require(account != address(0), "Invalid address: zero address not allowed");
        require(role != Role.None,     "Use revokeRole to remove a role");
        require(uint8(role) <= 5,      "Invalid role: value must be between 1 and 5");
        _roles[account] = role;
        emit RoleGranted(account, role, msg.sender);
    }

    /**
     * @notice Remove the role from an address, returning it to None.
     * @param  account  The address to remove the role from.
     */
    function revokeRole(address account) external onlyAdmin {
        require(account != address(0),         "Invalid address: zero address not allowed");
        require(_roles[account] != Role.None,  "Address has no role to revoke");
        _roles[account] = Role.None;
        emit RoleRevoked(account, msg.sender);
    }

    /**
     * @notice Returns the role currently assigned to an address.
     * @param  account  The address to query.
     * @return The Role enum value (0 = None if no role is assigned).
     */
    function getRole(address account) external view returns (Role) {
        return _roles[account];
    }

    // =========================================================================
    // Battery Lifecycle – Write Functions
    // =========================================================================

    /**
     * @notice Register a new battery batch. Records the mining/extraction stage.
     * @dev    Only a Supplier may call this. The batchId must be globally unique.
     *         Advances stage from Unregistered → Registered.
     * @param  batchId        Unique identifier for this batch, e.g. "BATCH-2024-001".
     * @param  mineLocation   Geographic origin of the raw materials.
     * @param  materialOrigin Comma-separated list of materials, e.g. "Cobalt, Lithium".
     */
    function registerBattery(
        string memory batchId,
        string memory mineLocation,
        string memory materialOrigin
    ) external onlySupplier {
        require(bytes(batchId).length > 0,        "Validation: batchId cannot be empty");
        require(bytes(mineLocation).length > 0,   "Validation: mineLocation cannot be empty");
        require(bytes(materialOrigin).length > 0, "Validation: materialOrigin cannot be empty");
        require(
            _batteries[batchId].currentStage == Stage.Unregistered,
            "Duplicate: a battery with this batch ID already exists"
        );

        Battery storage b = _batteries[batchId];
        b.batchId        = batchId;
        b.mineLocation   = mineLocation;
        b.materialOrigin = materialOrigin;
        b.registeredAt   = block.timestamp;
        b.registeredBy   = msg.sender;
        b.currentStage   = Stage.Registered;

        _batchIds.push(batchId);

        emit BatteryRegistered(batchId, mineLocation, materialOrigin, msg.sender, block.timestamp);
        emit StageAdvanced(batchId, Stage.Registered, msg.sender, block.timestamp);
    }

    /**
     * @notice Record refining and material-processing data.
     * @dev    Only a Supplier may call this. Requires Stage.Registered.
     *         Advances stage from Registered → Refined.
     * @param  batchId           The batch ID registered in the previous step.
     * @param  refiningDetails   Description of the refining process and purity achieved.
     * @param  recycledContentPct Percentage of recycled material input (0–100).
     */
    function recordRefining(
        string memory batchId,
        string memory refiningDetails,
        uint8         recycledContentPct
    ) external onlySupplier batteryExists(batchId) atStage(batchId, Stage.Registered) {
        require(bytes(refiningDetails).length > 0, "Validation: refiningDetails cannot be empty");
        require(recycledContentPct <= 100,         "Validation: recycledContentPct must be between 0 and 100");

        Battery storage b = _batteries[batchId];
        b.refiningDetails    = refiningDetails;
        b.recycledContentPct = recycledContentPct;
        b.currentStage       = Stage.Refined;

        emit StageAdvanced(batchId, Stage.Refined, msg.sender, block.timestamp);
    }

    /**
     * @notice Record manufacturing and vehicle assembly data.
     * @dev    Only a Manufacturer may call this. Requires Stage.Refined.
     *         Advances stage from Refined → Manufactured.
     * @param  batchId               The batch ID.
     * @param  manufacturingDetails  Description of the cell and pack assembly process.
     * @param  carbonFootprintKg     Self-reported CO2-equivalent in kg. Must be > 0.
     * @param  vehicleVIN            Vehicle Identification Number the battery is installed in.
     * @param  qualityPassed         True if the battery passed quality inspection.
     */
    function recordManufacturing(
        string  memory batchId,
        string  memory manufacturingDetails,
        uint256        carbonFootprintKg,
        string  memory vehicleVIN,
        bool           qualityPassed
    ) external onlyManufacturer batteryExists(batchId) atStage(batchId, Stage.Refined) {
        require(bytes(manufacturingDetails).length > 0, "Validation: manufacturingDetails cannot be empty");
        require(bytes(vehicleVIN).length > 0,           "Validation: vehicleVIN cannot be empty");
        require(carbonFootprintKg > 0,                  "Validation: carbonFootprintKg must be greater than zero");

        Battery storage b = _batteries[batchId];
        b.manufacturingDetails = manufacturingDetails;
        b.carbonFootprintKg    = carbonFootprintKg;
        b.vehicleVIN           = vehicleVIN;
        b.qualityPassed        = qualityPassed;
        b.currentStage         = Stage.Manufactured;

        emit StageAdvanced(batchId, Stage.Manufactured, msg.sender, block.timestamp);
    }

    /**
     * @notice Record distribution and delivery data.
     * @dev    Only a Manufacturer may call this. Requires Stage.Manufactured.
     *         Advances stage from Manufactured → Distributed.
     * @param  batchId             The batch ID.
     * @param  distributionDetails Description of shipment, ownership transfer and delivery.
     */
    function recordDistribution(
        string memory batchId,
        string memory distributionDetails
    ) external onlyManufacturer batteryExists(batchId) atStage(batchId, Stage.Manufactured) {
        require(bytes(distributionDetails).length > 0, "Validation: distributionDetails cannot be empty");

        Battery storage b = _batteries[batchId];
        b.distributionDetails = distributionDetails;
        b.currentStage        = Stage.Distributed;

        emit StageAdvanced(batchId, Stage.Distributed, msg.sender, block.timestamp);
    }

    /**
     * @notice Record that a battery has reached end-of-life and been collected.
     * @dev    Only a Supplier may call this. Requires Stage.Distributed.
     *         Advances stage from Distributed → EndOfLife.
     * @param  batchId  The batch ID.
     */
    function recordEndOfLife(
        string memory batchId
    ) external onlySupplier batteryExists(batchId) atStage(batchId, Stage.Distributed) {
        _batteries[batchId].currentStage = Stage.EndOfLife;
        emit StageAdvanced(batchId, Stage.EndOfLife, msg.sender, block.timestamp);
    }

    /**
     * @notice Record recycling data and recovered materials.
     * @dev    Only a Supplier may call this. Requires Stage.EndOfLife.
     *         Advances stage from EndOfLife → Recycled. This is the final stage.
     * @param  batchId            The batch ID.
     * @param  recoveredMaterials Description of materials recovered for reuse.
     */
    function recordRecycling(
        string memory batchId,
        string memory recoveredMaterials
    ) external onlySupplier batteryExists(batchId) atStage(batchId, Stage.EndOfLife) {
        require(bytes(recoveredMaterials).length > 0, "Validation: recoveredMaterials cannot be empty");

        Battery storage b = _batteries[batchId];
        b.recoveredMaterials = recoveredMaterials;
        b.currentStage       = Stage.Recycled;

        emit StageAdvanced(batchId, Stage.Recycled, msg.sender, block.timestamp);
    }

    // =========================================================================
    // Read Functions
    // =========================================================================

    /**
     * @notice Returns the public Battery Passport. Callable by anyone.
     * @dev    Returns only fields suitable for public disclosure. Excludes the
     *         supplier wallet address (registeredBy) and internal refiningDetails.
     *
     *         NOTE: This function has no role check, reflecting the QR-code-based
     *         public access described in the Volvo–Circulor case study. However,
     *         the absence of a role check here does NOT make other contract data
     *         confidential – all storage is readable at the node level regardless.
     *
     * @param  batchId  The batch ID to query.
     * @return A PublicPassport struct with selected fields.
     */
    function getPublicPassport(string memory batchId)
        external
        view
        batteryExists(batchId)
        returns (PublicPassport memory)
    {
        Battery storage b = _batteries[batchId];
        return PublicPassport({
            batchId:              b.batchId,
            mineLocation:         b.mineLocation,
            materialOrigin:       b.materialOrigin,
            recycledContentPct:   b.recycledContentPct,
            carbonFootprintKg:    b.carbonFootprintKg,
            manufacturingDetails: b.manufacturingDetails,
            vehicleVIN:           b.vehicleVIN,
            qualityPassed:        b.qualityPassed,
            distributionDetails:  b.distributionDetails,
            recoveredMaterials:   b.recoveredMaterials,
            currentStage:         b.currentStage
        });
    }

    /**
     * @notice Returns the complete Battery record including all internal fields.
     * @dev    Restricted to Admin and Regulator. Includes supplier address and
     *         refining details not shown in the public passport.
     *
     *         NOTE: This role restriction prevents unauthorised function calls.
     *         It does NOT encrypt storage – a node operator can still read raw
     *         state directly. See the contract-level disclaimer for details.
     *
     * @param  batchId  The batch ID to query.
     * @return The complete Battery struct.
     */
    function getFullPassport(string memory batchId)
        external
        view
        onlyAdminOrRegulator
        batteryExists(batchId)
        returns (Battery memory)
    {
        return _batteries[batchId];
    }

    /**
     * @notice Returns an array of all registered batch IDs.
     * @dev    Restricted to Admin and Regulator for supply-chain audit purposes.
     * @return An ordered array of batch ID strings.
     */
    function getAllBatchIds()
        external
        view
        onlyAdminOrRegulator
        returns (string[] memory)
    {
        return _batchIds;
    }
}
