import * as DCommon from "@duplojs/lang/common";
import { parseOrderId, runScenario } from "./kernel";

DCommon.print(parseOrderId(42));
DCommon.print(parseOrderId(-5));
DCommon.print(runScenario(100042));
