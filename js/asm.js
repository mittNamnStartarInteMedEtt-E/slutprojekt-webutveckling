// i spent 30 minutes writing comments for this
function createRegisters() {
    // backing storage for the 4 general purpose register families A, B, C, D
    // Uint32Array forces every value to be a 32 bit unsigned integer
    // this means values automatically wrap around to the negatives on overflow
    const backing = new Uint32Array(4);

    // maps each register family letter to its index in the backing array
    const INDEX = { A: 0, B: 1, C: 2, D: 3 };
    const regs = {};

    // backing storage for special registers that dont have sub-registers
    const special = new Uint32Array(5);
    const SPECIAL = { ESP: 0, EBP: 1, ESI: 2, EDI: 3, EIP: 4 };


    for (const [letter, i] of Object.entries(INDEX)) {
        // in short, the Object.defineProperty get() function runs every time you read the value
        // while the set() function runs every time you write to it
        // making this really useful cause otherwise i'd have to write functionality for
        // every time i wanted to write or read from the register variables


        // EAX is the full 32 bit register
        // getter just returns the raw value, no masking needed
        // setter uses >>> 0 to force the value into an unsigned 32 bit integer
        // without >>> 0 you could accidentally store a float or negative number

        // E_X registers
        Object.defineProperty(regs, `E${letter}X`, {
            get() { return backing[i]; },
            set(val) { backing[i] = val >>> 0; }
        });

        // AX is the lower 16 bits of EAX
        // getter: & 0xFFFF masks out the upper 16 bits, keeping only bits 0-15
        // example: 0xDEADBEEF & 0x0000FFFF = 0x0000BEEF
        // setter: & 0xFFFF0000 keeps the upper 16 bits of backing intact
        // | (val & 0xFFFF) merges in the new lower 16 bits
        // example: upper: 0xDEAD0000 lower: 0x00001234 result: 0xDEAD1234

        // _X registers
        Object.defineProperty(regs, `${letter}X`, {
            get() { return backing[i] & 0xFFFF; },
            set(val) { backing[i] = (backing[i] & 0xFFFF0000) | (val & 0xFFFF); }
        });

        // AH is bits 8 to 15 of EAX (the high byte of AX)
        // getter: & 0xFF00 isolates bits 8-15, >> 8 shifts them down to bits 0-7
        // example: 0xDEADBEEF & 0x0000FF00 = 0x0000BE00, >> 8 = 0x000000BE
        // setter: & 0xFFFF00FF zeroes out bits 8-15, preserving everything else
        // (val & 0xFF) << 8 shifts val up into bits 8-15
        // example: val=0x12: 0x12 << 8 = 0x1200, merged into backing at bits 8-15

        // _H registers
        Object.defineProperty(regs, `${letter}H`, {
            get() { return (backing[i] & 0xFF00) >> 8; },
            set(val) { backing[i] = (backing[i] & 0xFFFF00FF) | ((val & 0xFF) << 8); }
        });

        // AL is the lowest 8 bits of EAX
        // getter: & 0xFF isolates bits 0-7, no shifting needed since its already at the bottom
        // 0xDEADBEEF & 0x000000FF = 0x000000EF
        // setter: & 0xFFFFFF00 zeroes out bits 0-7, preserving everything else
        // | (val & 0xFF) merges in the new low byte
        // e.g val=0x12: backing becomes 0xDEADBE12

        // _L registers
        Object.defineProperty(regs, `${letter}L`, {
            get() { return backing[i] & 0xFF; },
            set(val) { backing[i] = (backing[i] & 0xFFFFFF00) | (val & 0xFF); }
        });
    }

    // special registers don't have sub-registers, like AH and AL
    // just a straight 32 bit read/write with >>> 0 clamping on set

    // e.g. ESP, EIP (stack pointer and instruction pointer)
    for (const [name, i] of Object.entries(SPECIAL)) {
        Object.defineProperty(regs, name, {
            get() { return special[i]; },
            set(val) { special[i] = val >>> 0; }
        });
    }

    // initialize stack pointer to the top of memory
    // the stack grows downward so ESP starts at the highest address
    regs.ESP = 1024 * 1024;

    return regs;
}

const cpu = {
    regs: createRegisters(),
    flags: {
        ZERO: false, // zero flag 
        CARRY: false, // carry flag
        SIGN: false, // sign flag
        OVERFLOW: false // overflow flag
    }
};

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

// module level variables
let lines = [];
let lineMap = [];
let labels = {};
let dataMap = {};
let defines = {};

// scan code for sections, variable definitions and macro definitions
// applies macro replacements and separates data from text sections
// returns array of {text, srcLine} keeping original line numbers
function preprocessCode(code) {
    lines = [];
    lineMap = [];
    labels = {};
    dataMap = {};
    defines = {};
    let section = "text";
    let memoryPtr = 0;
    const rawLines = code.split("\n");
    const processed = [];

    rawLines.forEach((rawLine, originalLineNum) => {
        // remove everything after semicolon (comments)
        rawLine = rawLine.split(";")[0].trim();
        if (rawLine === "") return;

        let tokens = rawLine.split(" ");

        // handle macro definitions
        if (tokens[0].toUpperCase() === "%DEFINE") {
            const macroName = tokens[1].toUpperCase();
            const macroValue = tokens[2];
            defines[macroName] = macroValue;
            return;
        }

        // substitute all defined macros into the line
        for (const [macroName, macroValue] of Object.entries(defines)) {
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

            console.log(dataValues);

            if (current.trim() !== "")
                dataValues.push(current.trim());

            const dataHandler = dataInstructions[dataType];
            if (!dataHandler) return;

            dataMap[varName] = memoryPtr;
            for (const val of dataValues) {
                memoryPtr = dataHandler(val, memoryPtr);
            }
        } else {
            // add text section line with original line number
            processed.push({ text: rawLine, srcLine: originalLineNum });
        }
    });

    return processed;
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
        if (operand.startsWith('"') && operand.endsWith('"'))
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
    const instructionList = [];

    // parse each line and attach original line number
    codeLines.forEach((rawCode, idx) => {
        const parsedLine = parseLine(rawCode);
        if (parsedLine) {
            parsedLine.srcLine = preprocessed[idx].srcLine;
            instructionList.push(parsedLine);
        }
    });

    // build label map and instruction list, skipping label definitions
    let instrIdx = 0;
    instructionList.forEach(instruction => {
        if (instruction.raw.endsWith(":")) {
            // label definition, map label name to instruction index
            labels[instruction.raw.slice(0, -1)] = instrIdx;
        } else {
            // actual instruction, add to executable list
            lines.push(instruction);
            lineMap.push(instruction.srcLine);
            instrIdx++;
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
    const preprocessed = preprocessCode(code);
    const codeText = preprocessed.map(p => p.text).join("\n");

    const jumpOps = ["JMP", "JE", "JNE", "JG", "JGE", "JL", "JLE", "CALL", "LOOP"];
    const instructionList = codeText.split("\n").map(parseLine).filter(line => line !== null);
    const errorList = [];

    // collect all label names first
    const labelNames = {};
    instructionList.forEach(instruction => {
        if (instruction.raw.toUpperCase().endsWith(":"))
            labelNames[instruction.raw.slice(0, -1).toUpperCase()] = true;
    });

    // validate each instruction
    instructionList.forEach((instruction, idx) => {
        if (instruction.raw.endsWith(":"))
            return; // skip label definitions

        // check for unknown instructions
        if (!instructions[instruction.op])
            errorList.push(`line ${idx + 1}: unknown instruction '${instruction.op}'`);

        // check jump target validity
        if (jumpOps.includes(instruction.op)) {
            if (!labelNames[instruction.args[0]])
                errorList.push(`line ${idx + 1}: unknown label '${instruction.args[0]}'`);
            return; // skip argument validation for jumps
        }

        // check argument validity
        instruction.args.forEach(arg => {
            if (!isValidArg(arg))
                errorList.push(`line ${idx + 1}: invalid argument '${arg}'`);
        });
    });

    return errorList;
}


// helper functions

// resolve an operand to its numeric value
// handles registers, data variables, memory references, hex literals, and decimal numbers
// example: "EAX" returns register value, "VAR" returns data address, "[EAX]" reads from memory, "0xFF" returns 255
function resolveVal(operand) {
    // check if it's a register
    if (cpu.regs[operand] !== undefined)
        return cpu.regs[operand];

    // check if it's a string literal
    if (operand.startsWith('"') && operand.endsWith('"'))
        return operand;

    // check if it's a memory reference like [EAX] or [0x1000]
    if (operand.startsWith("[") && operand.endsWith("]"))
        return read32(resolveVal(operand.slice(1, -1)));

    // check if it's a hex literal
    if (operand.startsWith("0X"))
        return parseInt(operand, 16);

    // check if it's a data variable name
    if (dataMap[operand] !== undefined)
        return dataMap[operand];

    // assume it's a decimal number
    return Number(operand);
}

// write a value to either a register or memory address
// if destination is [EAX] or similar, write to memory at that address
// otherwise write directly to the register
function writeDst(destination, value) {
    if (destination.startsWith("[") && destination.endsWith("]")) {
        // memory write: resolve address and store value
        write32(resolveVal(destination.slice(1, -1)), value);
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
        const result = Math.floor(a / b);

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

        updateFlags(result, false, overflow);
        writeDst(args[0], result);
    },

    // decrement dest by 1
    DEC(args) {
        const result = resolveVal(args[0]) - 1;

        // check for 32 bit int overflow
        const overflow =  result < 0;

        updateFlags(result);
        writeDst(args[0], result);
    },

    // compare dest and src
    CMP(args) {
        const a = resolveVal(args[0]);
        const b = resolveVal(args[1]);
        const result = a - b;

        updateFlags(result);
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

    PRINT(args) {
        const val = args[0];
        if (val.startsWith("[") && val.endsWith("]")) {
            let addr = resolveVal(val.slice(1, -1));
            let str = "";
            while (memory[addr] !== 0)
                str += String.fromCharCode(memory[addr++]);
            log(str, false, false);
        } else {
            log(resolveVal(val), false, false);
        }
    },

    PRINTLN(args) {
        const val = args[0];
        if (val.startsWith("[") && val.endsWith("]")) {
            let addr = resolveVal(val.slice(1, -1));
            let str = "";
            while (memory[addr] !== 0)
                str += String.fromCharCode(memory[addr++]);
            log(str, false, true);
        } else {
            log(resolveVal(val), false, true);
        }
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
};

// execute a single instruction with ui updates
function execute(instruction) {
    // highlight the instruction being executed
    highlightLine(cpu.regs.EIP);

    const handler = instructions[instruction.op];
    if (handler)
        handler(instruction.args);
}

// execute one instruction, incrementing eip if no jump occurred
function step() {
    if (cpu.regs.EIP >= lines.length)
        return;

    const currentInstruction = lines[cpu.regs.EIP];
    const eipBefore = cpu.regs.EIP;

    execute(currentInstruction);

    // if instruction didn't set eip (no jump), increment it
    if (cpu.regs.EIP === eipBefore)
        cpu.regs.EIP++;

    updateUIRegisters();
    updateUIFlags();   
}

// run the program with optional delay between instructions
function run(delay) {
    const executionTimer = setInterval(() => {
        step();
        if (cpu.regs.EIP >= lines.length) {
            clearInterval(executionTimer);
            isRunning = false;
            document.querySelector("#btn-run").disabled = false;
        }
    }, delay);
}