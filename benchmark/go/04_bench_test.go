// Exo 04 — projects/04/dist/add.ts/add.ts.go
// TS source: add(-1, 2) → EitherFail → isRight faux → pipe(whenIsRight) passthrough
// La branche fail fait que l'IIFE retourne Sourced_result tel quel (pas de ValueObject)
package Sourced_001bhome001bbrutal001bDesktop001bProjets001besgi001bcroco0019ecole0019go00192026001bprojects001b04001badd001ats

import (
	"testing"

	"duplojs.local/transpiled/shard_dependencies"
)

func BenchmarkExo04(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		Sourced_result := Sourced_add(-1, 2)
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
