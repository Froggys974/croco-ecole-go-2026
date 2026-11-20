import { GoAST, GoPrinter } from "@go";
import * as DString from "@duplojs/lang/string";
import { sharedDependencyImportDeclaration, sharedDependencyPackageName } from "@transformer";
import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import * as DGenerator from "@duplojs/lang/generator";
import * as DModeling from "@duplojs/lang/modeling";
import { TsAST } from "@typescript";
import { createBuildContext } from "./context/build";
import { createFileContext } from "./context/file";
import type { TranspilationContext } from "./context/transpilation";
import { sourceFileTransformers } from "./transformers";
import { createFile } from "./createFile";
import { createSourcePackageLayout } from "./sourcePackage";

interface TransformedFileContent {
	declarations: GoAST.GoFile["declarations"];
	init: readonly GoAST.Statement[];
}

export async function transformSourceFile(
	sourceFile: TsAST.SourceFile,
	transpilationContext: TranspilationContext,
) {
	const fileContext = DCommon.pipe(
		createFileContext(sourceFile),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(fileContext)) {
		return fileContext;
	}
	const context = createBuildContext(transpilationContext, fileContext);

	const content = await DCommon.asyncPipe(
		sourceFile.statements,
		DGenerator.asyncReduce(
			DGenerator.reduceFrom<TransformedFileContent>({
				declarations: [],
				init: [],
			}),
			async({ item, lastValue, next, exit }) => {
				// Imports et déclarations de type : rien à l'exécution (effacés comme en JS).
				// Les types sont traduits là où ils sont utilisés (cf. type/alias.ts).
				if (
					TsAST.isImportDeclaration(item)
					|| TsAST.isTypeAliasDeclaration(item)
					|| TsAST.isInterfaceDeclaration(item)
				) {
					return next(lastValue);
				}

				const statement = await DCommon.asyncPipe(
					context.transform(item, sourceFileTransformers.value),
					DEither.keepAsRightByInformation("transformation-success"),
					DEither.unwrapRight,
				);

				if (DEither.isLeft(statement)) {
					return exit(statement);
				}

				const result = statement.result;
				const init = DArray.concat(lastValue.init, statement.before);

				if (DModeling.hasTagGroup(result, "declaration")) {
					return next({
						declarations: DArray.push(lastValue.declarations, result),
						init,
					});
				}

				return next({
					declarations: lastValue.declarations,
					init: DArray.push(init, result),
				});
			},
		),
	);

	if (DEither.isLeft(content)) {
		return content;
	}

	const dependencyImports = DCommon.pipe(
		fileContext.dependencyFiles,
		DGenerator.reduce(
			DGenerator.reduceFrom<readonly GoAST.ImportDeclaration[]>([]),
			({ item, lastValue, next, exit }) => {
				const sourcePackage = DCommon.pipe(
					createSourcePackageLayout(transpilationContext.projectWorkDirectory, item),
					DEither.unwrapRight,
				);
				if (DEither.isLeft(sourcePackage)) {
					return exit(sourcePackage);
				}
				return next(DArray.push(lastValue, GoAST.createImportDeclaration({ path: sourcePackage.importPath })));
			},
		),
	);

	if (DEither.isLeft(dependencyImports)) {
		return dependencyImports;
	}

	const packageName = context.createSourceIdentifier(fileContext.currentFilePath);
	const declarations = DArray.concat(
		content.declarations,
		DArray.from(fileContext.declarations),
	);

	// Go refuse un import inutilisé. L'import du runtime peut avoir été enregistré
	// pour un type finalement non écrit (ex. vérification d'une conversion inutile) :
	// on ne le garde que si le code généré y fait vraiment référence.
	const usesSharedDependencies = DString.includes(
		GoPrinter.printGoFile(createFile({
			packageName,
			imports: [],
			declarations,
			init: content.init,
		})),
		`${sharedDependencyPackageName.value}.`,
	);

	return DEither.success({
		file: createFile({
			packageName,
			imports: DArray.concat(
				dependencyImports,
				DArray.filter(
					DArray.from(fileContext.imports),
					(importDeclaration) => usesSharedDependencies
						|| importDeclaration !== sharedDependencyImportDeclaration,
				),
			),
			declarations,
			init: content.init,
		}),
		context,
	});
}
