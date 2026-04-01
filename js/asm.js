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

// check for sections, variables and defines
// replaces variables with the actual value and returns the clean code
function preprocessCode(code) {
    lines = [];
    lineMap = [];
    labels = {};
    dataMap = {};
    defines = {};

    let section = "text";
    let dataPtr = 0;

    const rawLines = code.split("\n");
    const parsed = [];

    rawLines.forEach((raw, srcLine) => {
        raw = raw.split(";")[0].trim();
        if (raw === "") return;

        let line = raw.split(" ");

        // handle %define globally
        if (line[0].toUpperCase() === "%DEFINE") {
            const name = line[1].toUpperCase();
            const value = line[2];
            defines[name] = value;
            return;
        }

        // apply defines BEFORE anything else
        for (const [name, value] of Object.entries(defines)) {
            raw = raw.replace(new RegExp(`\\b${name}\\b`, "gi"), value);
        }

        line = raw.split(/\s+/);

        // section switching
        if (raw.toUpperCase() === "SECTION .DATA") {
            section = "data";
            return;
        } else if (raw.toUpperCase() === "SECTION .TEXT") {
            section = "text";
            return;
        }

        // data section
        if (section === "data") {
            if (line.length < 3) return;

            const name = line[0].toUpperCase();
            const type = line[1].toUpperCase();
            const values = line.slice(2).join(" ").split(",").map(v => v.trim());

            const fn = dataInstructions[type];
            if (!fn) return;

            dataMap[name] = dataPtr;

            for (const val of values) {
                dataPtr = fn(val, dataPtr);
            }

        } else {
            parsed.push({ text: raw, srcLine });
        }
    });

    parsed.forEach(entry => lineMap.push(entry.srcLine));

    return parsed.map(entry => entry.text).join("\n");
}

// parse assembly lines
function parseLine(line) {
    line = line.split(";")[0].trim(); // remove ; comments
    if (line === "")
        return null; // if line is empty return null

    const parts = line.split(" "); // split line into parts
    let op = parts[0].toUpperCase(); // operation
    let args = parts.slice(1).join(" ").split(", ").map(a => a.trim()); // splits the arguments of the line into an array

    // if arg is a string, dont uppercase
    args = args.map(a => {
        if (a.startsWith('"') && a.endsWith('"'))
            return a;
        return a.toUpperCase();
    });

    return { raw: line.toUpperCase(), op: op, args: args };
}

// parse labels
function loadProgram(code) {

    code = preprocessCode(code);
    const rawLines = code.split("\n");
    const parsed = [];

    // parse each line
    rawLines.forEach((raw) => {
        const line = parseLine(raw);
        if (line)
            parsed.push(line);
    });

    // find labels and build lines
    let instrIndex = 0;
    parsed.forEach(line => {
        if (line.raw.endsWith(":")) {
            // store where this label points in the instruction list
            labels[line.raw.slice(0, -1)] = instrIndex;
        } else {
            lines.push(line);
            instrIndex++;
        }
    });
}

// checks for errors in arguments
function isValidArg(str) {
    if (str.startsWith('"') && str.endsWith('"'))
        return true;
    return cpu.regs[str] !== undefined || !isNaN(resolveVal(str));
}

// checks for errors and typos
function validate(code) {
    code = preprocessCode(code);

    const jumpOps = ["JMP", "JE", "JNE", "JG", "JGE", "JL", "JLE", "CALL", "LOOP"];
    const parsed = code.split("\n").map(parseLine).filter(line => line !== null);
    const errors = [];

    // collect labels first
    const labelNames = {};
    parsed.forEach(line => {
        if (line.raw.toUpperCase().endsWith(":"))
            labelNames[line.raw.slice(0, -1).toUpperCase()] = true;
    });

    // for each line and its index
    parsed.forEach((line, index) => {
        if (line.raw.endsWith(":"))
            return; // skip label definitions

        // check for invalid instructions
        if (!instructions[line.op])
            errors.push(`line ${index + 1}: unknown instruction '${line.op}'`);

        // check jump targets
        if (jumpOps.includes(line.op)) {
            if (!labelNames[line.args[0]])
                errors.push(`line ${index + 1}: unknown label '${line.args[0]}'`);
            return; // skip argument check for jumps
        }

        // check for invalid arguments
        line.args.forEach(arg => {
            if (!isValidArg(arg))
                errors.push(`line ${index + 1}: invalid argument '${arg}'`);
        });
    });

    return errors;
}


// helper functions

// gets the value of a register, data variable, or plain number
// "EAX" -> cpu.regs.EAX, "VAR" -> read32(dataMap.VAR), "42" -> 42
function resolveVal(val) {
    if (cpu.regs[val] !== undefined)
        return cpu.regs[val];

    // if string
    if (val.startsWith('"') && val.endsWith('"'))
        return val;

    // if memory reference
    if (val.startsWith("[") && val.endsWith("]"))
        return read32(resolveVal(val.slice(1, -1)));

    // if hex
    if (val.startsWith("0X"))
        return parseInt(val, 16);

    // data section
    if (dataMap[val] !== undefined)
        return dataMap[val];

    return Number(val);
}

// handles writing to both registers and memory addresses
// if dst is something like [EAX] it writes to that address in memory
// otherwise just writes to the register directly
function writeDst(dst, val) {
    if (dst.startsWith("[") && dst.endsWith("]")) {
        write32(resolveVal(dst.slice(1, -1)), val);
    } else {
        cpu.regs[dst] = val;
    }
}

// updates cpu flags
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

    // print string or value
    PRINT(args) {
        const val = args[0];
        if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
            log(val.slice(1, -1)); // strip quotes and print
        } else {
            log(resolveVal(val));
        }
    },

    // print string or value with newline
    PRINTLN(args) {
        const val = args[0];
        if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
            log(val.slice(1, -1), false, true); // strip quotes and print
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
    DB(value, dataPtr) {
        write8(dataPtr, Number(value));
        return dataPtr + 1;
    },

    DW(value, dataPtr) {
        write16(dataPtr, Number(value));
        return dataPtr + 2;
    },

    DD(value, dataPtr) {
        write32(dataPtr, Number(value));
        return dataPtr + 4;
    },
};

// execute instruction
function execute(inst) {
    // highlight current line
    highlightLine(cpu.regs.EIP);

    const fn = instructions[inst.op];

    if (fn)
        fn(inst.args);
}

// execute one line
function step() {
    if (cpu.regs.EIP >= lines.length)
        return;

    const inst = lines[cpu.regs.EIP];
    const prevEIP = cpu.regs.EIP;

    execute(inst);

    if (cpu.regs.EIP === prevEIP)
        cpu.regs.EIP++;

    updateUIRegisters();
    updateUIFlags();
}

// run with a delay (or none)
function run(delay) {
    const timer = setInterval(() => {
        step();
        if (cpu.regs.EIP >= lines.length) {
            clearInterval(timer); // stop when program ends
            isRunning = false;
            btnRun.disabled = false;
        }
    }, delay);
}