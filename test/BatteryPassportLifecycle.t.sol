// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import { Test } from "forge-std/Test.sol";
import { BatteryPassport } from "../contracts/BatteryPassport.sol";

/// @notice Per-transition tests: each lifecycle step succeeds only for the right
///         role, at the right stage, with valid input, and a revert never changes state.
contract BatteryPassportLifecycleTest is Test {
    BatteryPassport internal passport;

    address internal supplier = makeAddr("supplier");
    address internal manufacturer = makeAddr("manufacturer");
    address internal regulator = makeAddr("regulator");
    address internal customer = makeAddr("customer");
    address internal outsider = makeAddr("outsider");

    string internal constant BATCH = "DEMO-BATCH-0002";

    bytes internal constant NOT_SUPPLIER = bytes("Access denied: Supplier role required");
    bytes internal constant NOT_MANUFACTURER = bytes("Access denied: Manufacturer role required");
    bytes internal constant WRONG_STAGE = bytes("Stage order violated: prerequisite stage not yet complete");

    function setUp() public {
        passport = new BatteryPassport();
        passport.grantRole(supplier, BatteryPassport.Role.Supplier);
        passport.grantRole(manufacturer, BatteryPassport.Role.Manufacturer);
        passport.grantRole(regulator, BatteryPassport.Role.Regulator);
        passport.grantRole(customer, BatteryPassport.Role.Customer);
    }

    function _stage() internal view returns (uint8) {
        return uint8(passport.getPublicPassport(BATCH).currentStage);
    }

    function _register() internal {
        vm.prank(supplier);
        passport.registerBattery(BATCH, "Demo Mine Site A", "Cobalt, Lithium");
    }

    function _refine() internal {
        vm.prank(supplier);
        passport.recordRefining(BATCH, "Purified to 99.5%", 16);
    }

    function _manufacture() internal {
        vm.prank(manufacturer);
        passport.recordManufacturing(BATCH, "Pack assembly", 5600, "DEMOVIN0000000001", true);
    }

    function _distribute() internal {
        vm.prank(manufacturer);
        passport.recordDistribution(BATCH, "Shipped to Gothenburg");
    }

    function _endOfLife() internal {
        vm.prank(supplier);
        passport.recordEndOfLife(BATCH);
    }

    // ------------------------------------------------------------ happy path, stage by stage

    function test_EachTransitionAdvancesExactlyOneStage() public {
        _register();
        assertEq(_stage(), uint8(BatteryPassport.Stage.Registered));
        _refine();
        assertEq(_stage(), uint8(BatteryPassport.Stage.Refined));
        _manufacture();
        assertEq(_stage(), uint8(BatteryPassport.Stage.Manufactured));
        _distribute();
        assertEq(_stage(), uint8(BatteryPassport.Stage.Distributed));
        _endOfLife();
        assertEq(_stage(), uint8(BatteryPassport.Stage.EndOfLife));
        vm.prank(supplier);
        passport.recordRecycling(BATCH, "Lithium, Cobalt recovered");
        assertEq(_stage(), uint8(BatteryPassport.Stage.Recycled));
    }

    // ------------------------------------------------------------ refining (the reported failure)

    function test_RefiningRightAfterRegistrationBySameSupplier() public {
        _register();
        vm.prank(supplier);
        passport.recordRefining(BATCH, "Purified", 0);
        assertEq(_stage(), uint8(BatteryPassport.Stage.Refined));
        assertEq(uint256(passport.getPublicPassport(BATCH).recycledContentPct), 0);
    }

    function test_RefiningAcceptsHundredPercent() public {
        _register();
        vm.prank(supplier);
        passport.recordRefining(BATCH, "Fully recycled input", 100);
        assertEq(uint256(passport.getPublicPassport(BATCH).recycledContentPct), 100);
    }

    function test_RefiningRejectsOver100Percent() public {
        _register();
        vm.expectRevert(bytes("Validation: recycledContentPct must be between 0 and 100"));
        vm.prank(supplier);
        passport.recordRefining(BATCH, "Purified", 101);
        assertEq(_stage(), uint8(BatteryPassport.Stage.Registered));
    }

    function test_RefiningRejectsEmptyDetails() public {
        _register();
        vm.expectRevert(bytes("Validation: refiningDetails cannot be empty"));
        vm.prank(supplier);
        passport.recordRefining(BATCH, "", 10);
        assertEq(_stage(), uint8(BatteryPassport.Stage.Registered));
    }

    function test_RefiningRejectsNonSupplierRoles() public {
        _register();
        address[4] memory others = [manufacturer, regulator, customer, outsider];
        for (uint256 i = 0; i < others.length; i++) {
            vm.expectRevert(NOT_SUPPLIER);
            vm.prank(others[i]);
            passport.recordRefining(BATCH, "Purified", 10);
        }
        vm.expectRevert(NOT_SUPPLIER);
        passport.recordRefining(BATCH, "Purified", 10); // Admin (this contract)
        assertEq(_stage(), uint8(BatteryPassport.Stage.Registered));
    }

    function test_RefiningTwiceRejected() public {
        _register();
        _refine();
        vm.expectRevert(WRONG_STAGE);
        vm.prank(supplier);
        passport.recordRefining(BATCH, "Again", 10);
    }

    // ------------------------------------------------------------ registration

    function test_RegistrationRejectsEmptyFields() public {
        vm.startPrank(supplier);
        vm.expectRevert(bytes("Validation: batchId cannot be empty"));
        passport.registerBattery("", "Mine", "Cobalt");
        vm.expectRevert(bytes("Validation: mineLocation cannot be empty"));
        passport.registerBattery(BATCH, "", "Cobalt");
        vm.expectRevert(bytes("Validation: materialOrigin cannot be empty"));
        passport.registerBattery(BATCH, "Mine", "");
        vm.stopPrank();
    }

    function test_RegistrationDuplicateRejectedEvenAfterLaterStages() public {
        _register();
        _refine();
        vm.expectRevert(bytes("Duplicate: a battery with this batch ID already exists"));
        vm.prank(supplier);
        passport.registerBattery(BATCH, "Other mine", "Nickel");
        assertEq(passport.getPublicPassport(BATCH).mineLocation, "Demo Mine Site A");
    }

    // ------------------------------------------------------------ manufacturing / distribution

    function test_ManufacturingValidationAndRole() public {
        _register();
        _refine();
        vm.expectRevert(NOT_MANUFACTURER);
        vm.prank(supplier);
        passport.recordManufacturing(BATCH, "Pack", 1, "VIN", true);

        vm.startPrank(manufacturer);
        vm.expectRevert(bytes("Validation: carbonFootprintKg must be greater than zero"));
        passport.recordManufacturing(BATCH, "Pack", 0, "VIN", true);
        vm.expectRevert(bytes("Validation: manufacturingDetails cannot be empty"));
        passport.recordManufacturing(BATCH, "", 1, "VIN", true);
        vm.expectRevert(bytes("Validation: vehicleVIN cannot be empty"));
        passport.recordManufacturing(BATCH, "Pack", 1, "", true);
        vm.stopPrank();
        assertEq(_stage(), uint8(BatteryPassport.Stage.Refined));
    }

    function test_DistributionRequiresManufacturedAndManufacturer() public {
        _register();
        _refine();
        vm.expectRevert(WRONG_STAGE);
        vm.prank(manufacturer);
        passport.recordDistribution(BATCH, "Too early");

        _manufacture();
        vm.expectRevert(NOT_MANUFACTURER);
        vm.prank(supplier);
        passport.recordDistribution(BATCH, "Wrong role");

        vm.expectRevert(bytes("Validation: distributionDetails cannot be empty"));
        vm.prank(manufacturer);
        passport.recordDistribution(BATCH, "");
        assertEq(_stage(), uint8(BatteryPassport.Stage.Manufactured));
    }

    // ------------------------------------------------------------ end of life / recycling

    function test_EndOfLifeRequiresDistributedAndSupplier() public {
        _register();
        _refine();
        _manufacture();
        vm.expectRevert(WRONG_STAGE);
        vm.prank(supplier);
        passport.recordEndOfLife(BATCH);

        _distribute();
        vm.expectRevert(NOT_SUPPLIER);
        vm.prank(manufacturer);
        passport.recordEndOfLife(BATCH);
        assertEq(_stage(), uint8(BatteryPassport.Stage.Distributed));
    }

    function test_RecyclingRequiresEndOfLifeSupplierAndMaterials() public {
        _register();
        _refine();
        _manufacture();
        _distribute();
        vm.expectRevert(WRONG_STAGE);
        vm.prank(supplier);
        passport.recordRecycling(BATCH, "Too early");

        _endOfLife();
        vm.expectRevert(NOT_SUPPLIER);
        vm.prank(manufacturer);
        passport.recordRecycling(BATCH, "Wrong role");
        vm.expectRevert(bytes("Validation: recoveredMaterials cannot be empty"));
        vm.prank(supplier);
        passport.recordRecycling(BATCH, "");
        assertEq(_stage(), uint8(BatteryPassport.Stage.EndOfLife));
    }

    function test_UnknownBatchRejectedForEveryStep() public {
        vm.expectRevert(bytes("Battery not found: batch ID does not exist"));
        passport.getPublicPassport("NO-SUCH-BATCH");
        vm.expectRevert(bytes("Battery not found: batch ID does not exist"));
        vm.prank(supplier);
        passport.recordEndOfLife("NO-SUCH-BATCH");
    }
}
