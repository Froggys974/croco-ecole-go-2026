import * as DCommon from "@duplojs/lang/common";
import { priceOrder, runScenario } from "./kernel";

DCommon.print(priceOrder(600));
DCommon.print(priceOrder(-50));
DCommon.print(runScenario(50000));
