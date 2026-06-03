FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Australia/Melbourne

# Core tools + compilers
RUN apt-get update && apt-get install -y \
    # Build essentials
    build-essential gcc g++ gdb make cmake \
    # Python
    python3 python3-pip python3-venv python3-dev \
    # Java
    default-jdk default-jre \
    # Node.js
    curl wget git \
    # LaTeX (full install for everything Monash may need)
    texlive-full latexmk \
    # Math / science Python libs
    libopenblas-dev liblapack-dev \
    # Utilities
    zip unzip jq \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Common Python packages for assignments
RUN pip3 install --no-cache-dir \
    numpy scipy matplotlib pandas sympy \
    scikit-learn pytest unittest-xml-reporting \
    jupyter notebook \
    requests flask fastapi uvicorn \
    networkx graphviz

# Common Node packages
RUN npm install -g jest mocha chai typescript ts-node

# Workspace
WORKDIR /workspace

# Test runner script
COPY scripts/run-tests.sh /usr/local/bin/run-tests
RUN chmod +x /usr/local/bin/run-tests

CMD ["tail", "-f", "/dev/null"]
