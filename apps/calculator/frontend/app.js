(function() {
    let current = '0';
    let expression = '';
    let lastOp = '';
    let resetNext = false;

    const resultEl = document.getElementById('result');
    const exprEl = document.getElementById('expr');

    function updateDisplay() {
        resultEl.textContent = current;
        exprEl.textContent = expression;
    }

    /* ── Safe math expression parser (no eval/Function) ──────── */
    function safeEval(expr) {
        // Normalize display operators to math operators
        expr = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
        // Tokenize
        var tokens = [];
        var i = 0;
        while (i < expr.length) {
            if (expr[i] === ' ') { i++; continue; }
            // Power operator: ^ becomes **
            if (expr[i] === '^') {
                tokens.push('**'); i++; continue;
            }
            // Two-char ** operator
            if (expr[i] === '*' && i + 1 < expr.length && expr[i + 1] === '*') {
                tokens.push('**'); i += 2; continue;
            }
            if ('()+*/-'.indexOf(expr[i]) !== -1) {
                // Handle unary minus: at start, after '(' or after an operator
                if (expr[i] === '-' && (tokens.length === 0 || tokens[tokens.length-1] === '(' || '+-*/**'.indexOf(tokens[tokens.length-1]) !== -1)) {
                    var num = '-';
                    i++;
                    while (i < expr.length && (expr[i] >= '0' && expr[i] <= '9' || expr[i] === '.')) {
                        num += expr[i]; i++;
                    }
                    if (num === '-') tokens.push('-1', '*');
                    else tokens.push(num);
                } else {
                    tokens.push(expr[i]); i++;
                }
            } else if ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.') {
                var num = '';
                while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
                    num += expr[i]; i++;
                }
                tokens.push(num);
            } else {
                i++; // skip unknown chars
            }
        }
        // Shunting-yard algorithm
        var output = [];
        var ops = [];
        var prec = {'+': 1, '-': 1, '*': 2, '/': 2, '**': 3};
        var rightAssoc = {'**': true};

        for (var t = 0; t < tokens.length; t++) {
            var tok = tokens[t];
            if (!isNaN(parseFloat(tok)) && isFinite(tok)) {
                output.push(parseFloat(tok));
            } else if (tok === '(') {
                ops.push(tok);
            } else if (tok === ')') {
                while (ops.length && ops[ops.length-1] !== '(') {
                    output.push(ops.pop());
                }
                ops.pop(); // remove '('
            } else if (prec[tok] !== undefined) {
                while (ops.length && ops[ops.length-1] !== '(' && prec[ops[ops.length-1]] !== undefined &&
                    (prec[ops[ops.length-1]] > prec[tok] || (prec[ops[ops.length-1]] === prec[tok] && !rightAssoc[tok]))) {
                    output.push(ops.pop());
                }
                ops.push(tok);
            }
        }
        while (ops.length) output.push(ops.pop());

        // Evaluate RPN
        var stack = [];
        for (var r = 0; r < output.length; r++) {
            var item = output[r];
            if (typeof item === 'number') {
                stack.push(item);
            } else {
                var b = stack.pop();
                var a = stack.pop();
                if (a === undefined || b === undefined) return NaN;
                if (item === '+') stack.push(a + b);
                else if (item === '-') stack.push(a - b);
                else if (item === '*') stack.push(a * b);
                else if (item === '/') stack.push(a / b);
                else if (item === '**') stack.push(Math.pow(a, b));
            }
        }
        return stack.length === 1 ? stack[0] : NaN;
    }

    function handleInput(v) {
        // Normalize minus: HTML sends U+002D, unify to U+2212 for display
        if (v === '-') v = '−';

        if (v === 'C') {
            current = '0'; expression = ''; lastOp = ''; resetNext = false;
            updateDisplay(); return;
        }
        if (v === '±') {
            if (current !== '0') current = current.startsWith('-') ? current.slice(1) : '-' + current;
            updateDisplay(); return;
        }
        if (v === '%') {
            current = String(parseFloat(current) / 100);
            updateDisplay(); return;
        }
        // Scientific functions
        if (['sin','cos','tan','√'].includes(v)) {
            var n = parseFloat(current);
            if (v === 'sin') current = String(Math.sin(n * Math.PI / 180));
            if (v === 'cos') current = String(Math.cos(n * Math.PI / 180));
            if (v === 'tan') current = String(Math.tan(n * Math.PI / 180));
            if (v === '√') current = String(Math.sqrt(n));
            current = formatNum(parseFloat(current));
            updateDisplay(); return;
        }
        if (v === '^') {
            expression += current + '^';
            lastOp = '^'; resetNext = true;
            updateDisplay(); return;
        }
        // Operators
        if (['+','−','×','÷'].includes(v)) {
            expression += current + ' ' + v + ' ';
            lastOp = v; resetNext = true;
            updateDisplay(); return;
        }
        if (v === '=') {
            expression += current;
            var result = safeEval(expression);
            current = formatNum(result);
            expression = '';
            lastOp = '';
            resetNext = true;
            updateDisplay();
            return;
        }
        // Parens
        if (v === '(' || v === ')') {
            expression += v;
            updateDisplay(); return;
        }
        // Digits & decimal
        if (resetNext) { current = '0'; resetNext = false; }
        if (v === '.') {
            if (!current.includes('.')) current += '.';
        } else {
            current = current === '0' ? v : current + v;
        }
        updateDisplay();
    }

    function formatNum(n) {
        if (!isFinite(n)) return 'Error';
        var s = String(n);
        return s.length > 12 ? n.toPrecision(10) : s;
    }

    // Button clicks
    document.querySelectorAll('.keypad button').forEach(function(btn) {
        btn.addEventListener('click', function() { handleInput(btn.dataset.v); });
    });

    // Keyboard input
    document.addEventListener('keydown', function(e) {
        var map = { Enter: '=', Escape: 'C', Backspace: 'C', '/': '÷', '*': '×', '-': '−', '+': '+', '%': '%', '.': '.' };
        if (map[e.key]) { handleInput(map[e.key]); return; }
        if (/^\d$/.test(e.key)) handleInput(e.key);
    });

    // Mode switching
    document.getElementById('mode-bar').addEventListener('click', function(e) {
        var btn = e.target.closest('.mode');
        if (!btn) return;
        document.querySelectorAll('.mode').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelectorAll('.keypad').forEach(function(k) { k.classList.remove('visible'); });
        document.getElementById('keypad-' + btn.dataset.mode).classList.add('visible');
    });

    updateDisplay();
})();
