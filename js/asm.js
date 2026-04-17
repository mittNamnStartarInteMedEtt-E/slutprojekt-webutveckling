// i spent 30 minutes writing comments for this
function createRegisters(cpu) {
    const regs = {};

    // backing storage for the 4 general purpose register families A, B, C, D
    // Uint32Array forces every value to be a 32 bit unsigned integer
    // this means values automatically wrap around to the negatives on overflow
    const registerBank = new Uint32Array(4);
    const STANDARD_REGS = { A: 0, B: 1, C: 2, D: 3 }; // maps each register family to index in backing array

    // backing storage for special registers that dont have sub-registers
    const specialBank = new Uint32Array(5);
    const SPECIAL_REGS = { ESP: 0, EBP: 1, ESI: 2, EDI: 3, EIP: 4 };

    // backing storange for the ST0-ST7 registers that handle floating point values
    // Float64Array is the closest thing to use in javascript
    // every value is a forced float, that wraps on overflow
    const floatBank = new Float64Array(8);

    // loop over standard regs
    for (const [letter, i] of Object.entries(STANDARD_REGS)) {
        // the Object.defineProperty get() function runs every time you read the value
        // while the set() function runs every time you write to it
        // making this really useful cause otherwise i'd have to write functionality for
        // every time i wanted to write or read from the register variables


        // EAX is the full 32 bit register
        // getter just returns the raw value, no masking needed
        // setter uses >>> 0 to force the value into an unsigned 32 bit integer
        // without >>> 0 you could accidentally store a float or negative number

        // E_X registers
        Object.defineProperty(regs, `E${letter}X`, {
            get() { return registerBank[i]; },
            set(val) { registerBank[i] = val >>> 0; }
        });

        // AX is the lower 16 bits of EAX
        // getter: & 0xFFFF masks out the upper 16 bits, keeping only bits 0-15
        // example: 0xDEADBEEF & 0x0000FFFF = 0x0000BEEF
        // setter: & 0xFFFF0000 keeps the upper 16 bits of backing intact
        // | (val & 0xFFFF) merges in the new lower 16 bits
        // example: upper: 0xDEAD0000 lower: 0x00001234 result: 0xDEAD1234

        // _X registers
        Object.defineProperty(regs, `${letter}X`, {
            get() { return registerBank[i] & 0xFFFF; },
            set(val) { registerBank[i] = (registerBank[i] & 0xFFFF0000) | (val & 0xFFFF); }
        });

        // AH is bits 8 to 15 of EAX (the high byte of AX)
        // getter: & 0xFF00 isolates bits 8-15, >> 8 shifts them down to bits 0-7
        // example: 0xDEADBEEF & 0x0000FF00 = 0x0000BE00, >> 8 = 0x000000BE
        // setter: & 0xFFFF00FF zeroes out bits 8-15, preserving everything else
        // (val & 0xFF) << 8 shifts val up into bits 8-15
        // example: val=0x12: 0x12 << 8 = 0x1200, merged into backing at bits 8-15

        // _H registers
        Object.defineProperty(regs, `${letter}H`, {
            get() { return (registerBank[i] & 0xFF00) >> 8; },
            set(val) { registerBank[i] = (registerBank[i] & 0xFFFF00FF) | ((val & 0xFF) << 8); }
        });

        // AL is the lowest 8 bits of EAX
        // getter: & 0xFF isolates bits 0-7, no shifting needed since its already at the bottom
        // 0xDEADBEEF & 0x000000FF = 0x000000EF
        // setter: & 0xFFFFFF00 zeroes out bits 0-7, preserving everything else
        // | (val & 0xFF) merges in the new low byte with OR
        // e.g val=0x12: backing becomes 0xDEADBE12

        // _L registers
        Object.defineProperty(regs, `${letter}L`, {
            get() { return registerBank[i] & 0xFF; },
            set(val) { registerBank[i] = (registerBank[i] & 0xFFFFFF00) | (val & 0xFF); }
        });
    }

    // special registers don't have sub-registers, like AH and AL
    // just a straight 32 bit read/write with >>> 0 clamping

    // ESI, EDI, EBP are included for authenticity but have no special behavior
    // ESP points to the top of the stack, at 1 MB currently
    // EIP points to the current instruction/line, so the first instruction would be 1, second would be 2, etc
    for (const [name, i] of Object.entries(SPECIAL_REGS)) {
        Object.defineProperty(regs, name, {
            get() { return specialBank[i]; },
            set(val) { specialBank[i] = val >>> 0; }
        });
    }

    // float registers, ST0-ST7
    for (let i = 0; i < 8; i++) {
        Object.defineProperty(regs, `ST${i}`, {
            get() {
                // calculate physical index (top + offset) % 8
                const index = (cpu.fpuTop + i) % 8;
                return floatBank[index];
            },
            set(val) {
                const index = (cpu.fpuTop + i) % 8;
                floatBank[index] = val;
            }
        });
    }

    // initialize stack pointer to the top of memory
    // the stack grows downward so ESP starts at the highest address
    regs.ESP = 1024 * 1024; // 1MB

    // clears float slot
    regs.clearFloatSlot = function() {
        floatBank[cpu.fpuTop] = 0;
    };

    return regs;
}

const cpu = {
    fpuTop: 0, // points to the physical index in floatBank that is currently ST0
    flags: {
        ZERO: false, // zero flag 
        CARRY: false, // carry flag
        SIGN: false, // sign flag
        OVERFLOW: false // overflow flag
    },
};
cpu.regs = createRegisters(cpu);

const memory = new Uint8Array(1024 * 1024); // 1 megabyte

function read8(addr) {
    return (memory[addr]);
}

function read16(addr) {
    return (memory[addr]) |
           (memory[addr + 1] << 8);
}

function read32(addr) {
    return (memory[addr]) |
           (memory[addr + 1] << 8) |
           (memory[addr + 2] << 16) |
           (memory[addr + 3] << 24); 
}

function write8(addr, val) {
    memory[addr] = val;
}

function write16(addr, val) {
    memory[addr] = val & 0xFF;
    memory[addr + 1] = (val >> 8) & 0xFF;
}

function write32(addr, val) {
    memory[addr] = val & 0xFF;
    memory[addr + 1] = (val >> 8) & 0xFF;
    memory[addr + 2] = (val >> 16) & 0xFF;
    memory[addr + 3] = (val >> 24) & 0xFF;
}

// buffer to help with conversion
const floatBuffer = new Float64Array(1);
const floatBytes = new Uint8Array(floatBuffer.buffer);

function writeFloat64(addr, val) {
    floatBuffer[0] = val;
    // copy 8 bytes into memory
    for (let i = 0; i < 8; i++) {
        memory[addr + i] = floatBytes[i];
    }
}

function readFloat64(addr) {
    // copy 8 bytes from memory
    for (let i = 0; i < 8; i++) {
        floatBytes[i] = memory[addr + i];
    }
    return floatBuffer[0];
}

// module level variables
let executableLines = [];
let instructionToSourceLine = [];
let labels = {};
let dataAddresses = {};
let macros = {};
let dataTypes = {};

// scan code for sections, variable definitions and macro definitions
// applies macro replacements and separates data from text sections
// returns array of {text, sourceLine} keeping original line numbers
function preprocessCode(code) {
    executableLines = [];
    instructionToSourceLine = [];
    labels = {};
    dataAddresses = {};
    macros = {};
    dataTypes = {};
    let section = "text";
    let dataPointer = 0x100;

    const rawLines = code.split("\n");
    const textLines = [];

    rawLines.forEach((rawLine, originalLineNum) => {
        // remove everything after semicolon (comments)
        rawLine = rawLine.split(";")[0].trim();
        if (rawLine === "") return;

        let tokens = rawLine.split(" ");

        // handle macro definitions
        if (tokens[0].toUpperCase() === "%DEFINE") {
            const macroName = tokens[1].toUpperCase();
            const macroValue = tokens[2];
            macros[macroName] = macroValue;
            return;
        }

        // substitute all defined macros into the line
        for (const [macroName, macroValue] of Object.entries(macros)) {
            rawLine = rawLine.replace(new RegExp(`\\b${macroName}\\b`, "gi"), macroValue);
        }

        tokens = rawLine.split(" ");

        // section switching
        if (rawLine.toUpperCase() === "SECTION .DATA") {
            section = "data";
            return;
        } else if (rawLine.toUpperCase() === "SECTION .TEXT") {
            section = "text";
            return;
        }

        // process data section declarations
        if (section === "data") {
            if (tokens.length < 3) return;
            const varName = tokens[0].toUpperCase();
            const dataType = tokens[1].toUpperCase();

            // split on commas but not inside strings
            const rawValues = tokens.slice(2).join(" ");
            const dataValues = [];
            let current = "";
            let inString = false;

            for (const char of rawValues) {
                if (char === '"') {
                    inString = !inString;
                    current += char;
                } else if (char === "," && !inString) {
                    dataValues.push(current.trim());
                    current = "";
                } else {
                    current += char;
                }
            }

            if (current.trim() !== "")
                dataValues.push(current.trim());

            const dataHandler = dataInstructions[dataType];
            if (!dataHandler) return;

            dataTypes[varName] = dataType;
            dataAddresses[varName] = dataPointer;
            for (const val of dataValues) {
                dataPointer = dataHandler(val, dataPointer);
            }
        } else {
            // add text section line with original line number
            textLines.push({ text: rawLine, sourceLine: originalLineNum });
        }
    });

    return textLines;
}


// tokenize and parse a single assembly line into operation and arguments
function parseLine(line) {
    // remove comments
    line = line.split(";")[0].trim();
    if (line === "") return null;

    const tokens = line.split(" ");
    const opcode = tokens[0].toUpperCase();
    let operands = tokens.slice(1).join(" ").split(", ").map(a => a.trim());

    // preserve string literals (dont uppercase quoted strings)
    operands = operands.map(operand => {
        if (operand.startsWith('"') && operand.endsWith('"') ||
            operand.startsWith("'") && operand.endsWith("'"))
            return operand;
        return operand.toUpperCase();
    });

    return { raw: line.toUpperCase(), op: opcode, args: operands };
}

// parse and load program into memory, extract labels and build instruction list
function loadProgram(code) {
    const preprocessed = preprocessCode(code);
    const codeText = preprocessed.map(p => p.text).join("\n");
    const codeLines = codeText.split("\n");
    const parsedInstructions = [];

    // parse each line and attach original line number
    codeLines.forEach((rawCode, i) => {
        const parsedLine = parseLine(rawCode);
        if (parsedLine) {
            parsedLine.sourceLine = preprocessed[i].sourceLine;
            parsedInstructions.push(parsedLine);
        }
    });

    // build label map and instruction list, skipping label definitions
    let executableIndex = 0;
    parsedInstructions.forEach(instruction => {
        if (instruction.raw.endsWith(":")) {
            // label definition, map label name to instruction index
            labels[instruction.raw.slice(0, -1)] = executableIndex;
        } else {
            // actual instruction, add to executable list
            executableLines.push(instruction);
            instructionToSourceLine.push(instruction.sourceLine);
            executableIndex++;
        }
    });
}

// checks for errors in arguments
function isValidArg(str) {
    if (str.startsWith('"') && str.endsWith('"'))
        return true;
    return cpu.regs[str] !== undefined || !isNaN(resolveVal(str));
}

// check for syntax errors in assembly code
function validate(code) {
    const jumpOps = ["JMP", "JE", "JNE", "JG", "JGE", "JL", "JLE", "CALL", "LOOP"];
    const printOps = ["PRINT", "PRINTLN", "PRINTC", "PRINTS", "PRINTI", "PRINTFL"];
    const errorList = [];

    const preprocessed = preprocessCode(code);
    const parsedInstructions = preprocessed.map(p => {
        const parsed = parseLine(p.text);
        if (parsed)
            parsed.sourceLine = p.sourceLine;
        return parsed;
    }).filter(line => line !== null);


    // collect all label names first
    const labelNames = {};
    parsedInstructions.forEach(instruction => {
        if (instruction.raw.toUpperCase().endsWith(":"))
            labelNames[instruction.raw.slice(0, -1).toUpperCase()] = true;
    });

    // validate each instruction
    parsedInstructions.forEach((instruction) => {
        if (instruction.raw.endsWith(":"))
            return; // skip label definitions

        // check for unknown instructions
        if (!instructions[instruction.op])
            errorList.push(`line ${instruction.sourceLine + 1}: unknown instruction '${instruction.op}'`);

        // check jump target validity
        if (jumpOps.includes(instruction.op)) {
            if (!labelNames[instruction.args[0]])
                errorList.push(`line ${instruction.sourceLine + 1}: unknown label '${instruction.args[0]}'`);
            return; // skip argument validation for jumps
        }

        // check print instruction arguments
        if (printOps.includes(instruction.op)) {
            const arg = instruction.args[0];

            // check printc 
            if (instruction.op === "PRINTC") {
                if (!arg.startsWith("'") && !arg.endsWith("'")) {
                    if (arg.split(1, -1).length() !== 1) {
                        errorList.push(`line ${instruction.sourceLine + 1}: PRINTC expects a single char, never 'char'`)
                    } else {
                        errorList.push(`line ${instruction.sourceLine + 1}: PRINTC expects a char in single quotes, like 'c'`);
                    }
                }
            } else if (instruction.op === "PRINTS") {
                if (!arg.startsWith('"') && !arg.endsWith('"')) {
                    errorList.push(`line ${instruction.sourceLine + 1}: PRINTS expects a string in double quotes, like "hello"`);
                }
            } else if (instruction.op === "PRINTI") {
                if (arg.includes(".")) {
                    errorList.push(`line ${instruction.sourceLine + 1}: PRINTI expects an int, like 7`);
                }
            } else if (instruction.op === "PRINTFL") {
                const isRegister = cpu.regs[arg] !== undefined;
                const isMemRef = arg.startsWith("[") && arg.endsWith("]");
                const isFloat = !isNaN(Number(arg)) && arg.includes(".");
                if (!isRegister && !isMemRef && !isFloat)
                    errorList.push(`line ${instruction.sourceLine + 1}: PRINTFL expects a float, like 3.14`);
            }
            return; // skip argument validation for prints
        }

        // check argument validity
        instruction.args.forEach(arg => {
            if (!isValidArg(arg))
                errorList.push(`line ${instruction.sourceLine + 1}: invalid argument '${arg}'`);
        });
    });

    return errorList;
}


// helper functions

// resolve an operand to its numeric value
// handles registers, data variables, memory references, hex literals, and decimal numbers
// example: "EAX" returns register value, "VAR" returns data address, "[EAX]" reads from memory, "0xFF" returns 255
function resolveVal(operand) {
    // check if its a register
    if (cpu.regs[operand] !== undefined)
        return cpu.regs[operand];

    // check if its a string literal
    if (operand.startsWith('"') && operand.endsWith('"'))
        return operand;

    // check if its a memory reference like [EAX] or [0x1000]
    if (operand.startsWith("[") && operand.endsWith("]"))
        return read32(resolveVal(operand.slice(1, -1)));

    // check for hex literal
    if (operand.startsWith("0X"))
        return parseInt(operand, 16);

    // check for data variable name
    if (dataAddresses[operand] !== undefined)
        return dataAddresses[operand];

    return Number(operand);
}

// handles values like resolveVal, but for floats
function resolveFloatVal(operand) {
    // if register
    if (cpu.regs[operand] !== undefined) {
        return cpu.regs[operand];
    }

    // if memory reference
    if (operand.startsWith("[") && operand.endsWith("]")) {
        const addr = resolveVal(operand.slice(1, -1));
        return readFloat64(addr); 
    }

    return Number(operand);
}

// helper that resolves a value for printing
function resolvePrintVal(val) {
    if (val.startsWith("[") && val.endsWith("]")) {
        const varName = val.slice(1, -1);
        if (dataTypes[varName] === "DB") {
            // string
            let addr = dataAddresses[varName];
            let str = "";
            while (memory[addr] !== 0)
                str += String.fromCharCode(memory[addr++]);
            return str;
        } else if (dataTypes[varName] === "DQ") {
            // float
            return readFloat64(resolveVal(varName));
        } else {
            return read32(resolveVal(varName));
        }
    } else if (val.startsWith('"') && val.endsWith('"') ||
               val.startsWith("'") && val.startsWith("'")) {
        return val.slice(1, -1).replace(/\\n/g, "\n");
    } else {
        const resolved = resolveVal(val);
        if (typeof resolved === "number" && dataAddresses[val] !== undefined) {
            return "0x" + resolved.toString(16).toUpperCase();
        }
        return resolved;
    }
}

// write a value to either a register or memory address
// if destination is [EAX] or similar, write to memory at that address
// otherwise write directly to the register
function writeDst(destination, value) {
    if (destination.startsWith("[") && destination.endsWith("]")) {
        // memory write
        write32(resolveVal(destination.slice(1, -1)), value);
    } else {
        // register write
        cpu.regs[destination] = value;
    }
}

// same but for floats
function writeFloatDst(destination, value) {
    if (destination.startsWith("[") && destination.endsWith("]")) {
        // memory write
        writeFloat64(resolveVal(destination.slice(1, -1)), value);
    } else {
        // register write
        cpu.regs[destination] = value;
    }
}

// update cpu flags based on operation result
function updateFlags(result, carry = false, overflow = false) {
    cpu.flags.ZERO = result === 0;
    cpu.flags.SIGN = (result & 0x80000000) !== 0;
    cpu.flags.CARRY = carry;
    cpu.flags.OVERFLOW = overflow;
}

// assembly instructions
const instructions = {
    // in here i refer to args[0] as destination or dest and args[1] as source or src 

    // move / copy a value from src to dest
    MOV(args) { 
        writeDst(args[0], resolveVal(args[1]));
    },

    // add src to dest
    ADD(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a + b;

        // check for 32 bit int overflow
        const overflow = result > 0xFFFFFFFF || result < 0;

        updateFlags(result, result > 0xFFFFFFFF, overflow);
        writeDst(args[0], result);
    },

    // subtract src from dest
    SUB(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a - b;

        // check for 32 bit int overflow
        const overflow = result < 0;
    
        updateFlags(result, result < 0, overflow);
        writeDst(args[0], result);
    },

    // multiply dest by src
    MUL(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a * b;

        // check for 32 bit int overflow
        const overflow = result > 0xFFFFFFFF;

        updateFlags(result, false, overflow);
        writeDst(args[0], result);
    },

    // divide dest by src
    DIV(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);

        let result = b == 0.0 ? undefined : Math.floor(a / b);

        updateFlags(result);
        writeDst(args[0], result);
    },

    // bitwise AND &
    AND(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a & b;

        updateFlags(result);
        writeDst(args[0], result);
    },

    // bitwise OR |
    OR(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a | b;

        updateFlags(result);
        writeDst(args[0], result);
    },

    // bitwise XOR ^ (exclusive or)
    XOR(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a ^ b;

        updateFlags(result);
        writeDst(args[0], result);
    },

    // bitwise NOT ~
    NOT(args) {
        const result = ~resolveVal(args[0]);

        updateFlags(result);
        writeDst(args[0], result);
    },

    // increment dest by 1
    INC(args) {
        const result = resolveVal(args[0]) + 1;

        // check for 32 bit int overflow
        const overflow = result > 0xFFFFFFFF || result < 0;

        updateFlags(result, cpu.flags.CARRY, overflow);
        writeDst(args[0], result);
    },

    // decrement dest by 1
    DEC(args) {
        const a = resolveVal(args[0]);
        const result = a - 1;

        const overflow = (a === 0x80000000);

        updateFlags(result, cpu.flags.CARRY, overflow);
        writeDst(args[0], result);
    },

    // load float, pushes a value, so moves pointer then stores
    FLD(args) {
        const val = resolveFloatVal(args[0]);
        cpu.fpuTop = (cpu.fpuTop - 1) & 7; // decrement ptr, stays in range 0-7
        cpu.regs.ST0 = val;
    },

    // store float, pops a value, so stores value then moves pointer
    FSTP(args) {
        const val = cpu.regs.ST0;

        writeFloatDst(args[0], val);
        cpu.regs.clearFloatSlot();
        cpu.fpuTop = (cpu.fpuTop + 1) & 7; // increment ptr, stays in range 0-7
    },

    // same as add but for floats
    FADD(args) {
        const a = resolveFloatVal(args[0]);
        const b = resolveFloatVal(args[1]);

        const result = a + b;

        updateFlags(result);
        writeFloatDst(args[0], result)
    },

    // same as sub but for floats
    FSUB(args) {
        const a = resolveFloatVal(args[0]);
        const b = resolveFloatVal(args[1]);

        const result = a - b;
    
        updateFlags(result);
        writeFloatDst(args[0], result);
    },

    // same as mul but for floats
    FMUL(args) {
        const a = resolveFloatVal(args[0]);
        const b = resolveFloatVal(args[1]);

        const result = a * b;

        updateFlags(result);
        writeFloatDst(args[0], result);
    },

    // same as div but for floats
    FDIV(args) {
        const a = resolveFloatVal(args[0]);
        const b = resolveFloatVal(args[1]);

        let result = b == 0.0 ? undefined : a / b;

        updateFlags(result);
        writeFloatDst(args[0], result);
    },

    // compare dest and src (by subtracting)
    CMP(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);

        const result = (a - b) >>> 0;
        const carry = a < b;
        const overflow = ((a ^ b) & (a ^ result) & 0x80000000) !== 0;

        updateFlags(result, carry, overflow);
    },

    // like CMP but uses bitwise AND, and only updates flags
    TEST(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);

        const result = a & b;

        updateFlags(result, false, false);
    },

    // unconditional jump to a label
    JMP(args) {
        cpu.regs.EIP = labels[args[0]];
    },

    // jump if equal
    JE(args) {
        if (cpu.flags.ZERO)
            cpu.regs.EIP = labels[args[0]];
    },

    // jump if not equal
    JNE(args) {
        if (!cpu.flags.ZERO)
            cpu.regs.EIP = labels[args[0]];
    },

    // jump if greater
    JG(args) {
        if (!cpu.flags.ZERO && cpu.flags.SIGN === cpu.flags.OVERFLOW)
            cpu.regs.EIP = labels[args[0]];
    },

    // jump if greater or equal
    JGE(args) {
        if (cpu.flags.SIGN === cpu.flags.OVERFLOW)
            cpu.regs.EIP = labels[args[0]];
    },

    // jump if less
    JL(args) {
        if (!cpu.flags.ZERO && cpu.flags.SIGN !== cpu.flags.OVERFLOW)
            cpu.regs.EIP = labels[args[0]];
    },

    // jump if less or equal
    JLE(args) {
        if (cpu.flags.ZERO || cpu.flags.SIGN !== cpu.flags.OVERFLOW)
            cpu.regs.EIP = labels[args[0]];
    },

    // jump if overflow
    JO(args) {
        if (cpu.flags.OVERFLOW)
            cpu.regs.EIP = labels[args[0]];
    },

    // jump if not overflow
    JNO(args) {
        if (!cpu.flags.OVERFLOW)
            cpu.regs.EIP = labels[args[0]];
    },

    // jump if zero
    JZ(args) {
        if (cpu.flags.ZERO)
            cpu.regs.EIP = labels[args[0]];
    },

    // jump if not zero
    JNZ(args) {
        if (!cpu.flags.ZERO)
            cpu.regs.EIP = labels[args[0]];
    },

    // jump if sign
    JS(args) {
        if (cpu.flags.SIGN) 
            cpu.regs.EIP = labels[args[0]];
    },

    // jump if not sign
    JNS(args) {
        if (!cpu.flags.SIGN)
            cpu.regs.EIP = labels[args[0]];
    },

    // bitshift left
    SHL(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a << b;

        // carry flag check
        const carry = b === 0 ? 0 : (a >>> (32 - b)) & 1;

        updateFlags(result, carry);
        writeDst(args[0], result)
    },

    // bitshift right
    SHR(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a >>> b;

        // carry flag check
        const carry = b === 0 ? 0 : (a >>> (b - 1)) & 1;

        updateFlags(result, carry);
        writeDst(args[0], result);
    },

    // push to stack
    PUSH(args) {
        const val = resolveVal(args[0]);
        
        cpu.regs.ESP -= 4;
        write32(cpu.regs.ESP, val);
    },

    // pop from stack
    POP(args) {
        const dest = args[0];
        const val = read32(cpu.regs.ESP);

        cpu.regs.ESP += 4;
        writeDst(dest, val);
    },
    
    // call function
    CALL(args) {
        cpu.regs.ESP -= 4;
        write32(cpu.regs.ESP, cpu.regs.EIP + 1);
        cpu.regs.EIP = labels[args[0]];
    },

    // return from function
    RET() {
        cpu.regs.EIP = read32(cpu.regs.ESP);
        cpu.regs.ESP += 4;
    },

    // print character, if string print the first character
    PRINTC(args) {
        const char = resolvePrintVal(args[0]);
        log(char[0]);
    },

    PRINTS(args) {
        const string = resolvePrintVal(args[0]);
        log(string);
    },

    PRINTI(args) {
        const integer = resolveVal(args[0]);
        log(integer);
    },
    
    PRINTFL(args) {
        const float = resolveFloatVal(args[0]);
        log(float);
    },

    PRINT(args) {
        const str = resolvePrintVal(args[0]);
        log(str);
    },

    PRINTLN(args) {
        const str = resolvePrintVal(args[0]);
        log(str, false, true);
    },

    // no operation
    NOP() {
        // does nothing
    },

    // decrement ECX and jump if not zero
    LOOP(args) {
        cpu.regs.ECX--;
        if (cpu.regs.ECX !== 0)
            cpu.regs.EIP = labels[args[0]];
    },

    // reads from the terminal and outputs it to dest, if argument is omitted, write to EBP
    async READI(args) {
        const dest = args[0] || "EBP";
        const input = await waitForInput();
        let val = Number(input);
        // if NaN then 0
        val = isNaN(val) ? 0 : val;

        writeDst(dest, val);
    },

    // same as READI but for floats
    async READFL(args) {
        const dest = args[0] || "EBP";
        const input = await waitForInput();
        let val = Number(input);

        // if NaN then 0
        val = isNaN(val) ? 0 : val;
        writeFloatDst(dest, val);
    },

    // same as READI but for strings, stores a pointer in dest
    async READS(args) {
        const dest = args[0] || "EBP";
        const input = await waitForInput();
    
        // write string into memory at 0x2000, the fixed input memory address
        const bufferAddr = 0x2000;
        for (let i = 0; i < input.length; i++)
            write8(bufferAddr + i, input.charCodeAt(i));
        write8(bufferAddr + input.length, 0); // null terminator
    
        writeDst(dest, bufferAddr);
    },

    async READC(args) {
        const dest = args[0] || "EBP";
        const input = await waitForInput();

        // write char into memory at 0x2000
        write8(0x2000, input.charCodeAt(0));
    },
};

// assembly data section definition instructions
const dataInstructions = {
    // define byte (also for strings, needs explicit null terminator)
    DB(value, dataPtr) {
        if (value.startsWith('"') && value.endsWith('"')) {
            const str = value.slice(1, -1);
            for (const char of str)
                write8(dataPtr++, char.charCodeAt(0));
            return dataPtr;
        }

        write8(dataPtr, Number(value));
        return dataPtr + 1;
    },

    // define word (2 bytes)
    DW(value, dataPtr) {
        write16(dataPtr, Number(value));
        return dataPtr + 2;
    },

    // define double word (4 bytes)
    DD(value, dataPtr) {
        write32(dataPtr, Number(value));
        return dataPtr + 4;
    },

    // define quad word (8 bytes)
    DQ(value, dataPtr) {
        writeFloat64(dataPtr, Number(value));
        return dataPtr + 8;
    }
};

// execute a single instruction with ui updates
async function execute(instruction) {
    // highlight the instruction being executed
    highlightLine(cpu.regs.EIP);

    const handler = instructions[instruction.op];
    if (handler) {
        await handler(instruction.args);
    }
}

// execute one instruction, incrementing eip if no jump occurred
async function step() {
    if (cpu.regs.EIP >= executableLines.length)
        return;

    const currentInstruction = executableLines[cpu.regs.EIP];
    const eipBefore = cpu.regs.EIP;

    await execute(currentInstruction);

    // if instruction didn't set eip (no jump), increment it
    if (cpu.regs.EIP === eipBefore)
        cpu.regs.EIP++;

    updateUIRegisters();
    updateUIFlags();   
}

// run the program with optional delay between instructions
async function run(delay) {

    // while not at end of program execute 
    while (cpu.regs.EIP < executableLines.length) {
        await step();

        // start delay timer 
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    isRunning = false;
}