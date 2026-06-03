/**
 * Mathematica MCP interface.
 * Calls the local Mathematica MCP server (if running) or falls back to
 * sympy inside the Docker container for symbolic math.
 */

const { spawnSync } = require('child_process');

const MCP_URL = process.env.MATHEMATICA_MCP_URL || 'http://localhost:8080';

/**
 * Evaluate a Mathematica expression via MCP HTTP endpoint.
 * Returns the result as a string.
 */
async function evaluateMathematica(expression) {
  try {
    const fetch = (await import('node-fetch')).default;
    const resp = await fetch(`${MCP_URL}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expression }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}`);
    const data = await resp.json();
    return { result: data.result, format: 'mathematica', expression };
  } catch (e) {
    // Fallback: use sympy in Docker container
    return evaluateSymPy(expression);
  }
}

/**
 * Fallback: translate Mathematica-like expressions to Python sympy
 * and evaluate inside the Docker container.
 */
function evaluateSymPy(expression) {
  const pyCode = `
import sympy as sp
from sympy import *
x, y, z, n, t = symbols('x y z n t')
try:
    result = eval(${JSON.stringify(expression)})
    print(repr(result))
except Exception as e:
    # Try as a sympy expression string
    try:
        result = sympify(${JSON.stringify(expression)})
        print(repr(result))
    except Exception as e2:
        print(f"ERROR: {e2}")
`;

  const container = process.env.DOCKER_CONTAINER_NAME || 'assignment-runner';
  const result = spawnSync('docker', [
    'exec', container, 'python3', '-c', pyCode
  ], { timeout: 30000, encoding: 'utf8' });

  return {
    result: result.stdout.trim() || result.stderr.trim(),
    format: 'sympy_fallback',
    expression,
    success: result.status === 0,
  };
}

/**
 * Format a mathematical result as LaTeX using Mathematica or sympy.
 */
async function toLatex(expression) {
  const sympyCode = `
import sympy as sp
from sympy import *
x, y, z, n, t = symbols('x y z n t')
expr = sympify(${JSON.stringify(expression)})
print(latex(expr))
`;
  const container = process.env.DOCKER_CONTAINER_NAME || 'assignment-runner';
  const result = spawnSync('docker', [
    'exec', container, 'python3', '-c', sympyCode
  ], { timeout: 15000, encoding: 'utf8' });
  return result.stdout.trim();
}

module.exports = { evaluateMathematica, evaluateSymPy, toLatex };

// ── n8n toolCode inline snippet ────────────────────────────────────────────
//
// const expression = $fromAI('expression', 'Mathematical expression to evaluate', 'string');
// const mcpUrl     = process.env.MATHEMATICA_MCP_URL || 'http://localhost:8080';
// const { spawnSync } = require('child_process');
//
// // Try MCP first
// let result;
// try {
//   const resp = await fetch(`${mcpUrl}/evaluate`, {
//     method: 'POST',
//     headers: {'Content-Type': 'application/json'},
//     body: JSON.stringify({ expression })
//   });
//   const data = await resp.json();
//   result = data.result;
// } catch {
//   // Fallback: sympy in Docker
//   const pyCode = `from sympy import *; x,y,z,n,t=symbols('x y z n t'); print(repr(sympify(${JSON.stringify(expression)})))`;
//   const r = spawnSync('docker', ['exec', 'assignment-runner', 'python3', '-c', pyCode], {timeout:15000,encoding:'utf8'});
//   result = r.stdout.trim();
// }
// return JSON.stringify({ result, expression });
