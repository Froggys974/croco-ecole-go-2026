import * as DCommon from "@duplojs/lang/common";
import { checkCredentials, runScenario } from "./kernel";

DCommon.print(checkCredentials(25, true, 5));
DCommon.print(checkCredentials(15, true, 5));
DCommon.print(runScenario(300000));
