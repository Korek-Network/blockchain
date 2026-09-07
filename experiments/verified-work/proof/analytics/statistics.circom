pragma circom 2.2.3;
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

// 128 rows, eight signed 16-bit channels. Public commitment binds the full
// ordered batch, all 44 statistics, and the job context. The circuit proves
// arithmetic over a committed batch, not whether a sensor told the truth.
template Statistics() {
    signal input data[128][8]; // Signed values offset by 32768.
    signal input sums[8]; // Offset by 128*32768.
    signal input crossProducts[36]; // Offset by 128*32768^2.
    signal input context[2];
    signal output commitment;
    component range[128][8];
    signal packed[128];
    for (var r = 0; r < 128; r++) {
        var row = 0;
        for (var c = 0; c < 8; c++) {
            range[r][c] = Num2Bits(16);
            range[r][c].in <== data[r][c];
            for (var bit = 0; bit < 16; bit++) {
                row += range[r][c].out[bit] * (2 ** (16*c + bit));
            }
        }
        packed[r] <== row; // Injective 128-bit packing, strictly below field size.
    }
    component contextRange[2];
    for (var c = 0; c < 2; c++) {
        contextRange[c] = Num2Bits(128);
        contextRange[c].in <== context[c];
    }
    for (var c = 0; c < 8; c++) {
        var total = 0;
        for (var r = 0; r < 128; r++) total += data[r][c] - 32768;
        sums[c] === total + 4194304;
    }
    signal products[36][128];
    var pair = 0;
    for (var a = 0; a < 8; a++) {
        for (var b = a; b < 8; b++) {
            var total = 0;
            for (var r = 0; r < 128; r++) {
                products[pair][r] <== (data[r][a]-32768) * (data[r][b]-32768);
                total += products[pair][r];
            }
            crossProducts[pair] === total + 137438953472;
            pair++;
        }
    }
    component chunks[8];
    component dataRoot = Poseidon(9);
    dataRoot.inputs[0] <== 1; // Versioned fixed-layout dataset domain.
    for (var i = 0; i < 8; i++) {
        chunks[i] = Poseidon(16);
        for (var j = 0; j < 16; j++) chunks[i].inputs[j] <== packed[i*16+j];
        dataRoot.inputs[i+1] <== chunks[i].out;
    }
    component resultChunks[3];
    for (var i = 0; i < 3; i++) {
        resultChunks[i] = Poseidon(16);
        for (var j = 0; j < 16; j++) {
            var k = i*16+j;
            if (k < 8) resultChunks[i].inputs[j] <== sums[k];
            else if (k < 44) resultChunks[i].inputs[j] <== crossProducts[k-8];
            else resultChunks[i].inputs[j] <== 0;
        }
    }
    component root = Poseidon(6);
    root.inputs[0] <== dataRoot.out;
    for (var i = 0; i < 3; i++) root.inputs[i+1] <== resultChunks[i].out;
    root.inputs[4] <== context[0];
    root.inputs[5] <== context[1];
    commitment <== root.out;
}
component main = Statistics();
