package main

import (
	target "duplojs.local/transpiled/kernel.ts"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"runtime"
	"sort"
	"strconv"
	"time"
)

type BenchResult struct {
	Checksum    int64   `json:"checksum"`
	P50NsPerOp  float64 `json:"p50NsPerOp"`
	P95NsPerOp  float64 `json:"p95NsPerOp"`
	P99NsPerOp  float64 `json:"p99NsPerOp"`
	MopsPerSec  float64 `json:"mopsPerSec"`
	BytesPerOp  float64 `json:"bytesPerOp"`
	AllocsPerOp float64 `json:"allocsPerOp"`
	NumGC       uint32  `json:"numGC"`
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func round3(v float64) float64 {
	return math.Round(v*1000) / 1000
}

func parseArgInt(idx int, fallback int) int {
	if len(os.Args) <= idx {
		return fallback
	}
	parsed, err := strconv.Atoi(os.Args[idx])
	if err != nil {
		return fallback
	}
	return parsed
}

func main() {
	baseSeed := parseArgInt(1, 100000)
	samplesCount := parseArgInt(2, 25)
	itersPerSample := parseArgInt(3, 40000)
	warmupIters := parseArgInt(4, 10000)

	var warm int64
	for i := 0; i < warmupIters; i++ {
		warm += int64(target.Sourced_runScenario(float64(baseSeed + i)))
	}
	_ = warm

	runtime.GC()
	var mStart, mEnd runtime.MemStats
	runtime.ReadMemStats(&mStart)

	var checksum int64
	samplesNs := make([]float64, samplesCount)
	for s := 0; s < samplesCount; s++ {
		offset := baseSeed + s*itersPerSample
		t0 := time.Now()
		var local int64
		for i := 0; i < itersPerSample; i++ {
			local += int64(target.Sourced_runScenario(float64(offset + i)))
		}
		samplesNs[s] = float64(time.Since(t0).Nanoseconds()) / float64(itersPerSample)
		checksum += local
	}

	runtime.ReadMemStats(&mEnd)
	totalOps := float64(samplesCount * itersPerSample)
	bytesPerOp := float64(mEnd.TotalAlloc-mStart.TotalAlloc) / totalOps
	allocsPerOp := float64(mEnd.Mallocs-mStart.Mallocs) / totalOps
	numGC := mEnd.NumGC - mStart.NumGC

	sort.Float64s(samplesNs)
	p50 := samplesNs[samplesCount/2]
	p95 := samplesNs[int(float64(samplesCount)*0.95)]
	p99 := samplesNs[samplesCount-1]

	out := BenchResult{
		Checksum:    checksum,
		P50NsPerOp:  round2(p50),
		P95NsPerOp:  round2(p95),
		P99NsPerOp:  round2(p99),
		MopsPerSec:  round2(1000.0 / p50),
		BytesPerOp:  round2(bytesPerOp),
		AllocsPerOp: round3(allocsPerOp),
		NumGC:       numGC,
	}

	raw, _ := json.Marshal(out)
	fmt.Println("===BENCH_GO_BEGIN===")
	fmt.Println(string(raw))
	fmt.Println("===BENCH_GO_END===")
}
