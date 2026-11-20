import * as DCommon from "@duplojs/lang/common";
import { computeMetric, runScenario } from "./kernel";

DCommon.print(computeMetric(10));
DCommon.print(computeMetric(-3));
DCommon.print(runScenario(120010));
