import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST, GoPrinter } from "@go";
import { TsAST } from "@typescript";
import { SymbolFlags, type Type } from "typescript/async";
import { type BuildContext } from "../../../context/build";
import { undefinedShardDependency } from "../../../sharedDependency/defaults";
import {
	eitherCompactDependency,
	eitherIdentifiers,
	eitherInterfaceDependency,
	eitherTaggedDependency,
} from "../../../sharedDependency/either";
import { typeTransformers } from "..";

const eitherFamilyTypeNames = new Set([
	"Success",
	"Fail",
	"Right",
	"Left",
	"Ok",
	"Error",
	"Some",
	"None",
	"Result",
	"Maybe",
	"SafeCallbackSuccess",
	"SafeCallbackError",
]);

interface AnalyzedEitherMember {
	readonly name: string;
	readonly payloadGoType?: GoAST.Type | GoAST.TypeReference;
}

function unwrapParenthesizedTypeNode(typeNode: TsAST.TypeNode): TsAST.TypeNode {
	let current = typeNode;

	while (TsAST.isParenthesizedTypeNode(current)) {
		current = current.type;
	}

	return current;
}

async function resolveTypeAliasSymbol(
	node: TsAST.TypeReferenceNode,
	context: BuildContext,
) {
	const { typeChecker } = context.transpilation;

	if (node.pos >= 0) {
		return typeChecker.getSymbolAtLocation(node.typeName);
	}

	if (TsAST.isIdentifier(node.typeName)) {
		return typeChecker.resolveName(
			node.typeName.text,
			SymbolFlags.Type,
			context.file.sourceFile,
		);
	}

	return undefined;
}

function getEitherPayloadIndex(name: string): number | undefined {
	if (name === "Success" || name === "Error") {
		return 0;
	}

	if (name === "Left" || name === "Right") {
		return 1;
	}

	return undefined;
}

async function expandUnionMembers(
	typeNodes: readonly TsAST.TypeNode[],
	context: BuildContext,
): Promise<readonly TsAST.TypeNode[]> {
	const { typeChecker } = context.transpilation;
	const result: TsAST.TypeNode[] = [];

	for (const rawNode of typeNodes) {
		const node = unwrapParenthesizedTypeNode(rawNode);

		if (TsAST.isUnionTypeNode(node)) {
			const nested = await expandUnionMembers(node.types, context);
			result.push(...nested);
			continue;
		}

		// Déplie un alias de type local non générique s'il pointe vers une union (ex: type Res = A | B).
		if (TsAST.isTypeReferenceNode(node) && !node.typeArguments) {
			const symbol = await resolveTypeAliasSymbol(node, context);

			if (symbol) {
				const declaredSymbol = symbol.flags & SymbolFlags.Alias
					? await typeChecker.getAliasedSymbol(symbol)
					: symbol;
				const handle = declaredSymbol.declarations && DArray.first(declaredSymbol.declarations);
				const declaration = handle && await handle.resolve();

				if (
					declaration
					&& TsAST.isTypeAliasDeclaration(declaration)
					&& !declaration.typeParameters
					&& TsAST.isUnionTypeNode(unwrapParenthesizedTypeNode(declaration.type))
				) {
					const expanded = await expandUnionMembers([declaration.type], context);
					result.push(...expanded);
					continue;
				}
			}
		}

		result.push(node);
	}

	return result;
}

async function analyzeEitherMember(
	memberNode: TsAST.TypeNode,
	context: BuildContext,
): Promise<AnalyzedEitherMember | undefined> {
	const unwrapped = unwrapParenthesizedTypeNode(memberNode);

	if (!TsAST.isTypeReferenceNode(unwrapped) && !TsAST.isImportTypeNode(unwrapped)) {
		return undefined;
	}

	const reference = TsAST.isTypeReferenceNode(unwrapped)
		? unwrapped.typeName
		: unwrapped;
	const moduleReference = await context.resolveReferenceModule(
		reference,
		"@duplojs/lang",
		/^dist\/either\//,
	);

	if (!DEither.hasInformation(moduleReference, "some")) {
		return undefined;
	}

	const name = DEither.unwrapRight(moduleReference).symbol.name;

	if (!eitherFamilyTypeNames.has(name)) {
		return undefined;
	}

	const payloadIndex = getEitherPayloadIndex(name);

	if (payloadIndex === undefined) {
		return { name };
	}

	const payloadNode = unwrapped.typeArguments && DArray.at(unwrapped.typeArguments, payloadIndex);

	if (!payloadNode) {
		return { name };
	}

	const transformed = await DCommon.asyncPipe(
		context.transform(payloadNode, typeTransformers.value),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(transformed) || !DArray.lengthEqual(transformed.before, 0)) {
		return undefined;
	}

	return {
		name,
		payloadGoType: transformed.result,
	};
}

function trySpecializeEitherUnion(
	members: readonly AnalyzedEitherMember[],
	context: BuildContext,
): GoAST.Type | GoAST.TypeReference | undefined {
	if (DArray.lengthEqual(members, 2)) {
		const successMember = members.find(
			(member) => member.name === "Success" && member.payloadGoType !== undefined,
		);
		const failMember = members.find((member) => member.name === "Fail");

		if (successMember?.payloadGoType && failMember) {
			return GoAST.createGenericTypeReference({
				typeReference: GoAST.createPackageTypeReference({
					packageName: context.registerSharedDependency(eitherCompactDependency.value),
					identifier: eitherIdentifiers.eitherCompactType,
				}),
				typeArguments: DCommon.cast([successMember.payloadGoType]),
			});
		}
	}

	// Vérifie si tous les membres sont couverts par EitherTagged[R, L] avec un seul R et un seul L.
	const taggedSupported = new Set(["Success", "Fail", "Ok", "Error", "Right", "Left"]);

	if (!DArray.every(members, (member) => taggedSupported.has(member.name))) {
		return undefined;
	}

	let rightType: GoAST.Type | GoAST.TypeReference | undefined = undefined;
	let rightRendered: string | undefined = undefined;
	let leftType: GoAST.Type | GoAST.TypeReference | undefined = undefined;
	let leftRendered: string | undefined = undefined;

	for (const member of members) {
		const isRightSide = member.name === "Success" || member.name === "Right";
		const isLeftSide = member.name === "Error" || member.name === "Left";

		if (isRightSide && member.payloadGoType) {
			const rendered = GoPrinter.renderNode(member.payloadGoType);
			if (rightRendered === undefined) {
				rightRendered = rendered;
				rightType = member.payloadGoType;
			} else if (rightRendered !== rendered) {
				return undefined;
			}
		}

		if (isLeftSide && member.payloadGoType) {
			const rendered = GoPrinter.renderNode(member.payloadGoType);
			if (rendered.endsWith(".JSUndefined")) {
				continue;
			}
			if (leftRendered === undefined) {
				leftRendered = rendered;
				leftType = member.payloadGoType;
			} else if (leftRendered !== rendered) {
				return undefined;
			}
		}
	}

	// Ok | Fail sans aucun payload : garder l'interface Either (0 octet pour Ok et Fail).
	if (!rightType && !leftType) {
		return undefined;
	}

	const fallbackUndefined = () => GoAST.createPackageTypeReference({
		packageName: context.registerSharedDependency(undefinedShardDependency.value),
		identifier: GoAST.createIdentifier("JSUndefined"),
	});

	return GoAST.createGenericTypeReference({
		typeReference: GoAST.createPackageTypeReference({
			packageName: context.registerSharedDependency(eitherTaggedDependency.value),
			identifier: eitherIdentifiers.eitherTaggedType,
		}),
		typeArguments: DCommon.cast([
			rightType ?? fallbackUndefined(),
			leftType ?? fallbackUndefined(),
		]),
	});
}

async function isEitherFamilyResolvedType(
	resolvedType: Type,
	context: BuildContext,
): Promise<boolean> {
	if (resolvedType.isUnionType()) {
		const members = await resolvedType.getTypes();

		return !DArray.lengthEqual(members, 0)
			&& (await Promise.all(
				members.map((member) => isEitherFamilyResolvedType(member, context)),
			)).every(Boolean);
	}

	const symbol = (await resolvedType.getAliasSymbol()) ?? (await resolvedType.getSymbol());

	if (!symbol) {
		return false;
	}

	const moduleReference = await context.resolveReferenceModule(
		symbol,
		"@duplojs/lang",
		/^dist\/either\//,
	);

	return DEither.hasInformation(moduleReference, "some")
		&& eitherFamilyTypeNames.has(DEither.unwrapRight(moduleReference).symbol.name);
}

export async function isEitherFamilyTypeNode(
	typeNode: TsAST.TypeNode,
	context: BuildContext,
): Promise<boolean> {
	const unwrapped = unwrapParenthesizedTypeNode(typeNode);

	if (TsAST.isUnionTypeNode(unwrapped)) {
		return !DArray.lengthEqual(unwrapped.types, 0)
			&& (await Promise.all(
				unwrapped.types.map((member) => isEitherFamilyTypeNode(member, context)),
			)).every(Boolean);
	}

	if (TsAST.isTypeReferenceNode(unwrapped) || TsAST.isImportTypeNode(unwrapped)) {
		const reference = TsAST.isTypeReferenceNode(unwrapped)
			? unwrapped.typeName
			: unwrapped;
		const moduleReference = await context.resolveReferenceModule(
			reference,
			"@duplojs/lang",
			/^dist\/either\//,
		);

		if (DEither.hasInformation(moduleReference, "some")) {
			return eitherFamilyTypeNames.has(DEither.unwrapRight(moduleReference).symbol.name);
		}
	}

	if (unwrapped.pos < 0) {
		return false;
	}

	const resolvedType = await context.transpilation.typeChecker.getTypeFromTypeNode(unwrapped);

	return isEitherFamilyResolvedType(resolvedType, context);
}

export async function resolveEitherUnionGoType(
	memberNodes: readonly TsAST.TypeNode[],
	context: BuildContext,
): Promise<GoAST.Type | GoAST.TypeReference> {
	const expanded = await expandUnionMembers(memberNodes, context);
	const analyzed = await Promise.all(
		expanded.map((member) => analyzeEitherMember(member, context)),
	);
	const validMembers = analyzed.filter(
		(item): item is AnalyzedEitherMember => item !== undefined,
	);

	if (validMembers.length === analyzed.length) {
		const specialized = trySpecializeEitherUnion(validMembers, context);
		if (specialized) {
			return specialized;
		}
	}

	return GoAST.createPackageTypeReference({
		packageName: context.registerSharedDependency(eitherInterfaceDependency.value),
		identifier: eitherIdentifiers.interface,
	});
}
