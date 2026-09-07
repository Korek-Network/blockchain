pragma circom 2.2.3;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

// Same signed-integer multiplication as ../workload.mjs, restricted to 4x4.
// Inputs are offset by +1000; outputs by +4,000,000. Range constraints
// prevent a finite-field wraparound from masquerading as integer arithmetic.
template Matrix4() {
    signal input a[16];
    signal input b[16];
    signal input c[16];
    signal input context[2];
    signal output commitment;

    component aLow[16];
    component aHigh[16];
    component bLow[16];
    component bHigh[16];
    for (var i = 0; i < 16; i++) {
        aLow[i] = Num2Bits(11);
        aHigh[i] = Num2Bits(11);
        bLow[i] = Num2Bits(11);
        bHigh[i] = Num2Bits(11);
        aLow[i].in <== a[i];
        aHigh[i].in <== 2000 - a[i];
        bLow[i].in <== b[i];
        bHigh[i].in <== 2000 - b[i];
    }
    component contextRange[2];
    for (var i = 0; i < 2; i++) {
        contextRange[i] = Num2Bits(128);
        contextRange[i].in <== context[i];
    }

    signal product[4][4][4];
    for (var row = 0; row < 4; row++) {
        for (var column = 0; column < 4; column++) {
            var sum = 0;
            for (var k = 0; k < 4; k++) {
                product[row][column][k] <== (a[row*4+k]-1000) * (b[k*4+column]-1000);
                sum += product[row][column][k];
            }
            c[row*4+column] === sum + 4000000;
        }
    }

    component hashA = Poseidon(16);
    component hashB = Poseidon(16);
    component hashC = Poseidon(16);
    for (var i = 0; i < 16; i++) {
        hashA.inputs[i] <== a[i];
        hashB.inputs[i] <== b[i];
        hashC.inputs[i] <== c[i];
    }
    component root = Poseidon(5);
    root.inputs[0] <== hashA.out;
    root.inputs[1] <== hashB.out;
    root.inputs[2] <== hashC.out;
    root.inputs[3] <== context[0];
    root.inputs[4] <== context[1];
    commitment <== root.out;
}

component main = Matrix4();
