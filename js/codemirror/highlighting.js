// all of this is for codemirror highlighting

CodeMirror.defineMode("asm", function() {
    const instructions = /^(FADD|FSUB|FMUL|FDIV|FLD|PRINTFL|PRINTC|PRINTS|PRINTI|MOV|ADD|SUB|MUL|DIV|INC|DEC|NEG|AND|OR|XOR|NOT|SHL|SHR|CMP|TEST|JMP|JE|JNE|JG|JL|JGE|JLE|JZ|JNZ|JC|JNC|JS|JNS|CALL|RET|PUSH|POP|NOP|HLT|INT|LEA|XCHG|CBW|CWD|PRINT|PRINTLN|LOOP)\b/i;
    const registers = /^(ST0|ST1|ST2|ST3|ST4|ST5|ST6|ST7|EAX|EBX|ECX|EDX|ESI|EDI|ESP|EBP|AX|BX|CX|DX|SI|DI|SP|BP|AH|AL|BH|BL|CH|CL|DH|DL)\b/i;
    const dataTypes = /^(DD|DW|DB|DQ|DT)\b/i;
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
            if (stream.match(/^SECTION/i)) { 
                // peek ahead to set state but don't match the whole thing
                if (stream.string.match(/SECTION\s+\.DATA/i)) state.inData = true;
                if (stream.string.match(/SECTION\s+\.TEXT/i)) state.inData = false;
                return "section"; 
            }
            // skip .data / .text labels without coloring
            if (stream.match(/^\.(DATA|TEXT)\b/i)) return null;

            // %define works everywhere
            if (stream.match(define)) return "keyword";

            if (state.inData) {
                if (stream.match(string)) return "string";
                if (stream.match(dataTypes)) return "keyword";
                if (stream.match(hex)) return "hex";
                // only highlight as number if not followed by a letter (i.e. not part of a variable name)
                if (stream.match(/^-?[0-9]+(?![A-Z_])/i)) return "number";
                // consume whole token as plain identifier (no color)
                if (stream.match(/^[A-Z0-9_]+/i)) return null;
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