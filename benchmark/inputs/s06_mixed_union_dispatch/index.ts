import * as DCommon from "@duplojs/lang/common";
import { decodePacket, runScenario } from "./kernel";

DCommon.print(decodePacket(10));
DCommon.print(decodePacket(60000));
DCommon.print(decodePacket(160000));
DCommon.print(decodePacket(250000));
DCommon.print(runScenario(160000));
