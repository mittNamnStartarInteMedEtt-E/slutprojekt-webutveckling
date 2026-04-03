CodeMirror.defineMode("asm", function() {
    const instructions = /^(MOV|ADD|SUB|MUL|DIV|INC|DEC|NEG|AND|OR|XOR|NOT|SHL|SHR|CMP|TEST|JMP|JE|JNE|JG|JL|JGE|JLE|JZ|JNZ|JC|JNC|JS|JNS|CALL|RET|PUSH|POP|NOP|HLT|INT|LEA|XCHG|CBW|CWD|PRINT|PRINTLN|LOOP)\b/i;
    const registers = /^(EAX|EBX|ECX|EDX|ESI|EDI|ESP|EBP|AX|BX|CX|DX|SI|DI|SP|BP|AH|AL|BH|BL|CH|CL|DH|DL)\b/i;
    const dataTypes = /^(DD|DW|DB|DQ|DT)\b/i;
    const section = /^(SECTION)\b/i;
    const define = /^(%DEFINE)\b/i;
    const label = /^\.?[A-Z_][A-Z0-9_]*:/i;
    const hex = /^0x[0-9a-fA-F]+/i;
    const number = /^-?[0-9]+\b/;
    const comment = /^;.*/;
    const string = /^"[^"]*"/;

    return {
        startState() {
            return { inData: false };
        },

        token: function(stream, state) {
            if (stream.eatSpace()) return null;

            // comments work everywhere
            if (stream.match(comment)) return "comment";

            // section switching
            if (stream.match(/^SECTION\s+\.DATA/i)) { state.inData = true;  return "keyword"; }
            if (stream.match(/^SECTION\s+\.TEXT/i)) { state.inData = false; return "keyword"; }

            // %define works everywhere
            if (stream.match(define)) return "keyword";

            if (state.inData) {
                // strings
                if (stream.match(string)) return "string";
                // data type keywords
                if (stream.match(dataTypes)) return "keyword";
                // hex and numbers (for raw byte values like 0, 10, 32)
                if (stream.match(hex)) return "hex";
                if (stream.match(number)) return "number";
                // everything else (variable names) — just advance, no color
                stream.next();
                return null;
            }

            // text section
            if (stream.match(label)) return "label";
            if (stream.match(instructions)) return "keyword";
            if (stream.match(registers)) return "variable";
            if (stream.match(hex)) return "hex";
            if (stream.match(number)) return "number";
            if (stream.match(string)) return "string";

            stream.next();
            return null;
        }
    };
});