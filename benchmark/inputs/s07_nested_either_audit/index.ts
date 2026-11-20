import * as DCommon from "@duplojs/lang/common";
import { outerAudit, runScenario } from "./kernel";

DCommon.print(outerAudit(90000));
DCommon.print(outerAudit(1000));
DCommon.print(outerAudit(250000));
DCommon.print(runScenario(90000));
