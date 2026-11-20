import * as DCommon from "@duplojs/lang/common";
import { type Transformer } from "@transformer";
import type { GoAST } from "@go";
import { duploJSTypeTransformers } from "../duplojs";
import { sharedTypeTransformers } from "../shared";
import { typeAliasReferenceTransformer } from "./alias";
import { arrayTypeTransformer } from "./array";
import { functionTypeTransformer } from "./function";
import { float64TypeTransformer } from "./float";
import { literalTypeTransformer } from "./literal";
import { parenthesizedTypeTransformer } from "./parenthesized";
import { booleanTypeTransformer, nullTypeTransformer, stringTypeTransformer } from "./primitive";
import { undefinedTypeTransformer } from "./undefined";
import { unionTypeTransformer } from "./union";

export const typeTransformers = DCommon.memo(
	(): readonly Transformer<GoAST.Type | GoAST.TypeReference>[] => [
		...duploJSTypeTransformers.value,
		...sharedTypeTransformers.value,
		typeAliasReferenceTransformer,
		parenthesizedTypeTransformer,
		unionTypeTransformer,
		arrayTypeTransformer,
		functionTypeTransformer,
		literalTypeTransformer,
		nullTypeTransformer,
		undefinedTypeTransformer,
		float64TypeTransformer,
		stringTypeTransformer,
		booleanTypeTransformer,
	],
);
