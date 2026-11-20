import * as DCommon from "@duplojs/lang/common";
import { GoAST } from "@go";
import { createSharedDependency } from "@transformer";
import { eitherIdentifiers } from "./helpers";

export const eitherInterfaceDependency = DCommon.memo(() => createSharedDependency({
	imports: [],
	init: [],
	declarations: [
		GoAST.createTypeDefinition({
			identifier: eitherIdentifiers.interface,
			type: GoAST.createInterfaceType({
				elements: [
					GoAST.createInterfaceMethod({
						identifier: eitherIdentifiers.isRightMethod,
						arguments: [],
						returnTypes: [GoAST.builtinTypeReferences.bool],
					}),
					GoAST.createInterfaceMethod({
						identifier: eitherIdentifiers.getInformationMethod,
						arguments: [],
						returnTypes: [GoAST.builtinTypeReferences.string],
					}),
					GoAST.createInterfaceMethod({
						identifier: eitherIdentifiers.getValueMethod,
						arguments: [],
						returnTypes: [GoAST.builtinTypeReferences.any],
					}),
				],
			}),
		}),
	],
}));
