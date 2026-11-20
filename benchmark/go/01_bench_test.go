// Exo 01 — projects/01/dist/add.ts/add.ts.go
// TS source: const result = add(1, 2); if (DEither.isRight(result)) { print(result) }
// Réplique le init() généré, sans les appels print (I/O exclue du bench)
package Sourced_001bhome001bbrutal001bDesktop001bProjets001besgi001bcroco0019ecole0019go00192026001bprojects001b01001badd001ats

import (
	"testing"

	"duplojs.local/transpiled/shard_dependencies"
)

func BenchmarkExo01(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		Sourced_result := Sourced_add(1, 2)
		_ = shard_dependencies.EitherIsRight(Sourced_result)
	}
}
