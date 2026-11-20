import * as DCommon from "@duplojs/lang/common";
import { routeCode, runScenario } from "./kernel";

DCommon.print(routeCode(200));
DCommon.print(routeCode(-1));
DCommon.print(routeCode(404));
DCommon.print(runScenario(100200));
