// Exo 03 — projects/03/dist/add.ts/add.ts.go
// TS source: add(1,2) → isRight → DCommon.pipe(result, DEither.whenIsRight(coalescing)) curried
// Go généré: IDENTIQUE à exo02 — le pipe est inliné par le transpileur → même IIFE
// Ce bench valide que pipe(whenIsRight(fn)) ≡ whenIsRight(result, fn) au niveau Go
package Sourced_001bhome001bbrutal001bDesktop001bProjets001besgi001bcroco0019ecole0019go00192026001bprojects001b03001badd001ats

import (
	"testing"

	"duplojs.local/transpiled/shard_dependencies"
)

func BenchmarkExo03(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		Sourced_result := Sourced_add(1, 2)
		_ = shard_dependencies.EitherIsRight(Sourced_result)
		_ = func() shard_dependencies.Value {
			if shard_dependencies.EitherIsRight(Sourced_result) {
				return shard_dependencies.ValueObject(([]float64{
					Sourced_result.Number(),
				}))
			}
			return Sourced_result
		}()
	}
}
