#!/bin/bash
# run-tests.sh - detect language and run appropriate test suite
set -e

WORKDIR=${1:-/workspace}
cd "$WORKDIR"

echo "=== Test Runner ==="
echo "Working directory: $WORKDIR"
echo "Contents:"
ls -la

PASS=0
FAIL=0
OUTPUT=""

run_python_tests() {
    echo "--- Python Tests ---"
    if [ -f "pytest.ini" ] || [ -f "setup.cfg" ] || ls test_*.py tests/*.py 2>/dev/null | head -1; then
        python3 -m pytest -v --tb=short 2>&1
    elif ls *.py 2>/dev/null | head -1; then
        echo "No pytest config found, running python -m unittest discover"
        python3 -m unittest discover -v 2>&1
    fi
}

run_java_tests() {
    echo "--- Java Tests ---"
    if [ -f "pom.xml" ]; then
        mvn test -q 2>&1
    elif ls *Test.java tests/*.java 2>/dev/null | head -1; then
        # Compile all java files
        find . -name "*.java" | xargs javac -cp ".:lib/*" 2>&1
        # Run test classes
        find . -name "*Test.class" | sed 's|./||;s|/|.|g;s|.class||' | \
            xargs -I{} java -cp ".:lib/*" {} 2>&1
    fi
}

run_cpp_tests() {
    echo "--- C/C++ Tests ---"
    if [ -f "Makefile" ]; then
        make test 2>&1 || make 2>&1 && ./test 2>&1
    elif ls *.cpp 2>/dev/null | head -1; then
        g++ -std=c++17 -o test_runner *.cpp 2>&1 && ./test_runner 2>&1
    fi
}

run_js_tests() {
    echo "--- JavaScript/TypeScript Tests ---"
    if [ -f "package.json" ]; then
        npm install --silent 2>&1
        npm test 2>&1
    fi
}

# Detect and run
if ls *.py test_*.py 2>/dev/null | head -1; then
    run_python_tests
fi
if ls *.java 2>/dev/null | head -1; then
    run_java_tests
fi
if ls *.cpp *.c 2>/dev/null | head -1; then
    run_cpp_tests
fi
if [ -f "package.json" ]; then
    run_js_tests
fi

echo "=== Tests Complete ==="
