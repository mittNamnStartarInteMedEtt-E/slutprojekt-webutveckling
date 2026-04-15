// code editor
const editor = CodeMirror.fromTextArea(document.getElementById("code-input"), {
    mode: "asm",
    theme: "custom",
    autoCloseBrackets: true,
    matchBrackets: true,
    lineNumbers: true,
});

// test program

editor.setValue(
`section .data
a dq 10.0
b dq 3.0
result dq 0.0

section .text
fld [a]         ; ST0 = 10.0
fld [b]         ; ST0 = 3.0, ST1 = 10.0

fadd st0, st1   ; ST0 = 13.0
printfl st0     ; prints 13.0
print "\\n"

fsub st0, st1   ; ST0 = 3.0
printfl st0     ; prints 3.0
print "\\n"

fmul st0, st1   ; ST0 = 30.0
printfl st0     ; prints 30.0
print "\\n"

fdiv st0, st1   ; ST0 = 3.0
printfl st0     ; prints 3.0
print "\\n"

fstp [result]   ; store 3.0 in result, pop
printfl st0     ; ST0 = 10.0 (was ST1 before pop)
print "\\n"
print [result]`
);

// speed slider
const speedSlider = document.getElementById("speed-slider");
const speedSpan   = document.getElementById("speed-display");

speedSlider.value = 0; // setting value here because html default wasnt working for whatever reason
speedSpan.textContent = "off";

speedSlider.addEventListener("input", () => {
    speedSpan.textContent = speedSlider.value == "0"
        ? "off"
        : (speedSlider.value / 1000).toFixed(1) + "s";
});

/* logic for updating ui */

let isRunning = false;

// resets registers, flags, highlights, and the log
function reset() {
    for (const reg of ["EAX", "EBX", "ECX", "EDX", "EBP", "ESI", "EDI", "EIP", "ST0", "ST1", "ST2", "ST3", "ST4", "ST5", "ST6", "ST7"])
        cpu.regs[reg] = 0;

    cpu.regs.ESP = 1024 * 1024; // stack starts at top of memory

    cpu.flags.ZERO = false;
    cpu.flags.CARRY = false;
    cpu.flags.SIGN = false;
    cpu.flags.OVERFLOW = false;
    cpu.fpuTop = 0;

    // remove the highlighted line from the editor if there is one
    if (highlightedLine !== null) {
        editor.removeLineClass(highlightedLine, "background", "current-line");
        highlightedLine = null;
    }

    executableIndex = [];
    updateUIRegisters();
    updateUIFlags();

    document.getElementById("log-output").value = "";
}

document.getElementById("btn-run").addEventListener("click", () => {
    // if already running, just stop and reset
    if (isRunning) {
        reset();
        isRunning = false;
        return;
    }

    reset();

    // check for errors before doing anything
    const errors = validate(editor.getValue());
    if (errors.length > 0) {
        for (const err of errors) 
            log(err, true);

        return;
    }

    isRunning = true;
    loadProgram(editor.getValue());

    if (speedSlider.value == "0") {
        run(0);
    } else {
        run(speedSlider.value);
    }
});

document.getElementById("btn-step").addEventListener("click", () => {
    if (isRunning) 
        return;

    // load the program on the first step
    if (cpu.regs.EIP === 0) {
        const errors = validate(editor.getValue());
        if (errors.length > 0) {
            for (const err of errors) 
                log(err, true);
            return;
        }
        loadProgram(editor.getValue());
    }

    step();
});

// make reset button call reset
document.getElementById("btn-reset").addEventListener("click", reset);

// registers shown in the main panel
const MAIN_REGISTER_NAMES = [
    "EAX", "EIP", "EBX", "ESP", "ECX", "EBP", "EDX", "ESI"
];

// makes an unsigned integer signed (can go negative)
function toSigned(val) {
    if (val > 0x7FFFFFFF) {
        return val - 0x100000000;
    } else {
        return val;
    }
}

function updateUIRegisters() {
    for (const reg of MAIN_REGISTER_NAMES) {
        const el = document.getElementById("reg-" + reg);
        if (el)
            el.querySelector(".reg-value").textContent = toSigned(cpu.regs[reg]);
    }

    // if the popup is open, keep it in sync too
    const popup = document.getElementById("reg-popup");
    if (popup && popup.style.display !== "none")
        renderRegisterPopup();
}

function updateUIFlags() {
    for (const flag of Object.keys(cpu.flags)) {
        const el = document.getElementById("flag-" + flag);
        if (el)
            el.querySelector(".flag-value").textContent = cpu.flags[flag];
    }
}

// highlights the current line in the editor based on EIP
let highlightedLine = null;
function highlightLine(eip) {
    // remove the old highlight first
    if (highlightedLine !== null)
        editor.removeLineClass(highlightedLine, "background", "current-line");

    // translate EIP to the real source line number
    const sourceLine = instructionToSourceLine[eip];
    if (sourceLine === undefined)
        return;

    editor.addLineClass(sourceLine, "background", "current-line");
    highlightedLine = sourceLine;
    
    // scroll the editor to find the highlighted line
    const info = editor.charCoords({ line: sourceLine, ch: 0 }, "local"); // relative to editor
    editor.scrollTo(null, info.top - 50); // 50px padding from top
}

// logs a message as output
function log(message, isError = false, newLine = false) {
    const logOutput = document.getElementById("log-output");

    if (isError) {
        logOutput.value += "[ERROR] " + message + '\n';
    } else if (newLine) {
        logOutput.value += message + '\n';
    } else {
        logOutput.value += message;
    }

    // keeps it scrolled to the newest message
    logOutput.scrollTop = logOutput.scrollHeight;
}

/* extra registers popup */

// register popup groups, each entry is a family of related registers
const POPUP_GROUPS = [
    { regs: ["EAX", "AX", "AH", "AL"] },
    { regs: ["EBX", "BX", "BH", "BL"] },
    { regs: ["ECX", "CX", "CH", "CL"] },
    { regs: ["EDX", "DX", "DH", "DL"] },
    { regs: ["ESP", "EBP", "ESI", "EDI", "EIP"] },
    { regs: ["ST0", "ST1", "ST2", "ST3", "ST4", "ST5", "ST6", "ST7"] },
];

// creates a single register span pair, name + value
function makeRegSpan(name) {
    const nameSpan = document.createElement("span");
    nameSpan.className = "reg-name";
    nameSpan.textContent = name + ":";

    const valSpan = document.createElement("span");
    valSpan.className = "reg-val";
    valSpan.textContent = name.startsWith("ST") ? cpu.regs[name] : toSigned(cpu.regs[name]);

    return [nameSpan, valSpan];
}

// rebuilds the popup content with current register values
function renderRegisterPopup() {
    const container = document.getElementById("reg-popup-body");
    if (!container)
        return;
    container.innerHTML = "";

    for (const group of POPUP_GROUPS) {
        const section = document.createElement("div");
        section.className = "reg-popup-group";

        // two registers per row, so step by 2
        for (let i = 0; i < group.regs.length; i += 2) {
            const row = document.createElement("div");
            row.className = "reg-popup-row";

            for (const span of makeRegSpan(group.regs[i])) 
                row.appendChild(span);

            if (group.regs[i + 1]) {
                for (const span of makeRegSpan(group.regs[i + 1])) 
                    row.appendChild(span);
            }

            section.appendChild(row);
        }
        container.appendChild(section);
    }
}

function openRegisterPopup() {
    renderRegisterPopup();
    if (document.getElementById("reg-popup").style.display === "block") {
        document.getElementById("reg-popup").style.display = "none";
    } else {
        document.getElementById("reg-popup").style.display = "block"
    }
}

function closeRegisterPopup() {
    document.getElementById("reg-popup").style.display = "none";
}

// makes an element draggable by clicking and dragging its handle
function makeDraggable(popup, handle) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener("mousedown", (event) => {
        dragging = true;
        // record where inside the popup the click happened
        // so it doesnt jump when you first click
        offsetX = event.clientX - popup.getBoundingClientRect().left;
        offsetY = event.clientY - popup.getBoundingClientRect().top;
    });

    document.addEventListener("mousemove", (event) => {
        if (!dragging) return;
        popup.style.left = (event.clientX - offsetX) + "px";
        popup.style.top  = (event.clientY - offsetY) + "px";
    });

    document.addEventListener("mouseup", () => { 
        dragging = false; 
    });
}

// make the buttons open and close the popup
document.getElementById("btn-show-regs").addEventListener("click", openRegisterPopup);
document.getElementById("btn-close-reg-popup").addEventListener("click", closeRegisterPopup);

// make the popup window draggable
makeDraggable(
    document.querySelector(".reg-popup-inner"),
    document.querySelector(".reg-popup-titlebar")
);

/* draggable resizer */

// make the horizontal resizer work
function makeHorizontalResizer(resizer) {
    resizer.addEventListener("mousedown", (e) => {
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);

        function onMouseMove(e) {
            const app = document.querySelector(".app");
            const totalWidth = app.getBoundingClientRect().width;
            const leftWidth = e.clientX;
            const rightWidth = totalWidth - leftWidth - 4; // 4px is resizer width

            const clampedLeft = Math.max(460, Math.min(leftWidth, totalWidth - 420));
            const clampedRight = totalWidth - clampedLeft - 4;
            
            app.style.gridTemplateColumns = `${clampedLeft}px 4px ${clampedRight}px`;
        }

        function onMouseUp() {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        }
    });
}

// make the vertical resizer work
function makeVerticalResizer(resizer) {
    resizer.addEventListener("mousedown", (e) => {
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);

        function onMouseMove(e) {
            const statePanel = document.querySelector(".state-panel");
            const regPanel = document.querySelector(".registers-panel");
            const logPanel = document.querySelector(".log-panel");

            const stateRect = statePanel.getBoundingClientRect();

            const stateTop = stateRect.top - 16; // top padding, 16px
            const stateHeight = stateRect.height - 32; // padding top + bottom, 32px
            const topHeight = e.clientY - stateTop;

            // clamp values so panels dont get too small
            const clampedTop = Math.max(100, Math.min(topHeight, stateHeight - 104)); // min width + resizer 4px
            const clampedBottom = stateHeight - clampedTop - 4; // resizer 4 px

            regPanel.style.flex = `0 0 ${clampedTop}px`;
            logPanel.style.flex = `0 0 ${clampedBottom}px`;
        }

        function onMouseUp() {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        }

    });
}

// create the actual resizers
makeHorizontalResizer(document.querySelector(".resizer-horizontal"));
makeVerticalResizer(document.querySelector(".resizer-vertical"));
