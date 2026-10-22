// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { Test } from "forge-std/Test.sol";
import { BatteryPassport } from "../contracts/BatteryPassport.sol";

/// @notice Unit tests for BatteryPassport. The test contract deploys the
///         passport in setUp(), so address(this) is the Admin.
contract BatteryPassportTest is Test {
    BatteryPassport internal passport;

    address internal admin;
    address internal supplier = makeAddr("supplier");
    address internal manufacturer = makeAddr("manufacturer");
    address internal regulator = makeAddr("regulator");
    address internal customer = makeAddr("customer");
    address internal outsider = makeAddr("outsider");

    string internal constant BATCH = "BATCH-2026-001";

    function setUp() public {
        passport = new BatteryPassport();
        admin = address(this);
    }

    function _grantAllRoles() internal {
        passport.grantRole(supplier, BatteryPassport.Role.Supplier);
        passport.grantRole(manufacturer, BatteryPassport.Role.Manufacturer);
        passport.grantRole(regulator, BatteryPassport.Role.Regulator);
        passport.grantRole(customer, BatteryPassport.Role.Customer);
    }

    function _register(string memory batchId) internal {
        vm.prank(supplier);
        passport.registerBattery(batchId, "Katanga, DRC", "Cobalt, Lithium");
    }

    // 1
    function test_DeploymentAssignsAdminToDeployer() public view {
        assertEq(uint8(passport.getRole(admin)), uint8(BatteryPassport.Role.Admin));
    }

    // 2
    function test_AdminCanGrantSupplier() public {
        passport.grantRole(supplier, BatteryPassport.Role.Supplier);
        assertEq(uint8(passport.getRole(supplier)), uint8(BatteryPassport.Role.Supplier));
    }

    // 3
    function test_NonAdminCannotGrantRoles() public {
        vm.expectRevert(bytes("Access denied: Admin role required"));
        vm.prank(outsider);
        passport.grantRole(outsider, BatteryPassport.Role.Supplier);

        assertEq(uint8(passport.getRole(outsider)), uint8(BatteryPassport.Role.None));
    }

    // 4
    function test_SupplierCanRegisterBattery() public {
        _grantAllRoles();
        _register(BATCH);

        BatteryPassport.PublicPassport memory p = passport.getPublicPassport(BATCH);
        assertEq(p.batchId, BATCH);
        assertEq(p.mineLocation, "Katanga, DRC");
        assertEq(p.materialOrigin, "Cobalt, Lithium");
        assertEq(uint8(p.currentStage), uint8(BatteryPassport.Stage.Registered));
    }

    // 5
    function test_UnauthorizedCannotRegisterBattery() public {
        _grantAllRoles();

        vm.expectRevert(bytes("Access denied: Supplier role required"));
        vm.prank(outsider);
        passport.registerBattery(BATCH, "Katanga, DRC", "Cobalt, Lithium");

        // A Manufacturer is also not allowed to register.
        vm.expectRevert(bytes("Access denied: Supplier role required"));
        vm.prank(manufacturer);
        passport.registerBattery(BATCH, "Katanga, DRC", "Cobalt, Lithium");
    }

    // 6
    function test_RefiningBeforeRegistrationRejected() public {
        _grantAllRoles();

        vm.expectRevert(bytes("Battery not found: batch ID does not exist"));
        vm.prank(supplier);
        passport.recordRefining(BATCH, "Purified to 99.5%", 15);
    }

    // 7
    function test_ManufacturingBeforeRefiningRejected() public {
        _grantAllRoles();
        _register(BATCH);

        vm.expectRevert(bytes("Stage order violated: prerequisite stage not yet complete"));
        vm.prank(manufacturer);
        passport.recordManufacturing(BATCH, "Cell and pack assembly", 45, "YV1EX90TEST00001", true);
    }

    // 8
    function test_DuplicateBatchIdRejected() public {
        _grantAllRoles();
        _register(BATCH);

        vm.expectRevert(bytes("Duplicate: a battery with this batch ID already exists"));
        vm.prank(supplier);
        passport.registerBattery(BATCH, "Pilbara, Australia", "Lithium");
    }

    // 9
    function test_PublicPassportAfterFullLifecycle() public {
        _grantAllRoles();
        _register(BATCH);

        vm.prank(supplier);
        passport.recordRefining(BATCH, "Purified to 99.5%", 20);

        vm.prank(manufacturer);
        passport.recordManufacturing(BATCH, "Cell and pack assembly", 45, "YV1EX90TEST00001", true);

        vm.prank(manufacturer);
        passport.recordDistribution(BATCH, "Shipped to Gothenburg dealership");

        vm.prank(supplier);
        passport.recordEndOfLife(BATCH);

        vm.prank(supplier);
        passport.recordRecycling(BATCH, "Lithium, Cobalt, Nickel recovered");

        // Called by an address with no role: the public passport is open to anyone.
        vm.prank(outsider);
        BatteryPassport.PublicPassport memory p = passport.getPublicPassport(BATCH);

        assertEq(p.batchId, BATCH);
        assertEq(p.mineLocation, "Katanga, DRC");
        assertEq(p.materialOrigin, "Cobalt, Lithium");
        assertEq(uint256(p.recycledContentPct), 20);
        assertEq(p.carbonFootprintKg, 45);
        assertEq(p.manufacturingDetails, "Cell and pack assembly");
        assertEq(p.vehicleVIN, "YV1EX90TEST00001");
        assertTrue(p.qualityPassed);
        assertEq(p.distributionDetails, "Shipped to Gothenburg dealership");
        assertEq(p.recoveredMaterials, "Lithium, Cobalt, Nickel recovered");
        assertEq(uint8(p.currentStage), uint8(BatteryPassport.Stage.Recycled));
    }

    // 10
    function test_RegulatorCanReadFullPassportCustomerCannot() public {
        _grantAllRoles();
        _register(BATCH);

        vm.prank(supplier);
        passport.recordRefining(BATCH, "Purified to 99.5%", 20);

        vm.prank(regulator);
        BatteryPassport.Battery memory full = passport.getFullPassport(BATCH);
        assertEq(full.batchId, BATCH);
        assertEq(full.registeredBy, supplier);
        assertEq(full.refiningDetails, "Purified to 99.5%");
        assertEq(uint8(full.currentStage), uint8(BatteryPassport.Stage.Refined));

        vm.expectRevert(bytes("Access denied: Admin or Regulator role required"));
        vm.prank(customer);
        passport.getFullPassport(BATCH);
    }
}
