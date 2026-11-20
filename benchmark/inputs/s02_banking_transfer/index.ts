import * as DCommon from "@duplojs/lang/common";
import { runScenario, validateTransfer } from "./kernel";

DCommon.print(validateTransfer(8000, 1500));
DCommon.print(validateTransfer(8000, 9500));
DCommon.print(validateTransfer(8000, -10));
DCommon.print(runScenario(52000));
