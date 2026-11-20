package Sourced_001bhome001bbrutal001bDesktop001bProjets001besgi001bcroco0019ecole0019go00192026001bprojects001b04001badd001ats

import (
	"testing"

	"duplojs.local/transpiled/shard_dependencies"
)

func BenchmarkAddSuccess(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		result := Sourced_add(1, 2)
		_ = shard_dependencies.EitherIsRight(result)
	}
}

func BenchmarkAddFail(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		result := Sourced_add(-1, 2)
		_ = shard_dependencies.EitherIsRight(result)
	}
}

func BenchmarkWhenIsRightSuccess(b *testing.B) {
	b.ReportAllocs()
	result := Sourced_add(1, 2)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Réplique exacte du IIFE généré par le transpileur (exo02/03)
		_ = func() shard_dependencies.Value {
			if shard_dependencies.EitherIsRight(result) {
				return shard_dependencies.ValueObject([]float64{result.Number()})
			}
			return result
		}()
	}
}

func BenchmarkWhenIsRightFail(b *testing.B) {
	b.ReportAllocs()
	result := Sourced_add(-1, 2)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = func() shard_dependencies.Value {
			if shard_dependencies.EitherIsRight(result) {
				return shard_dependencies.ValueObject([]float64{result.Number()})
			}
			return result
		}()
	}
}

func BenchmarkFullPipeline(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		result := Sourced_add(1, 2)
		_ = func() shard_dependencies.Value {
			if shard_dependencies.EitherIsRight(result) {
				return shard_dependencies.ValueObject([]float64{result.Number()})
			}
			return result
		}()
	}
}
