# If any docker wizard is interested, a multi-stage build would be better for caching
# and reducing the size of the final image

# The python version to use is supplied as an arg from SST
ARG PYTHON_VERSION=3.12

# Use an official AWS Lambda base image for Python
FROM public.ecr.aws/lambda/python:${PYTHON_VERSION} as builder

# # Ensure git is installed so we can install git based dependencies (such as sst)
ARG PYTHON_RUNTIME

# Install git and gcc using appropriate package manager based on Python version
RUN dnf install -y git gcc gcc-c++ openssl-devel

# Install Rust using rustup
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y

# Add Cargo to PATH
ENV PATH="/root/.cargo/bin:${PATH}"

# Install UV to manage your python runtime
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Install the dependencies to the lambda runtime
COPY requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN uv pip install -r requirements.txt --target ${LAMBDA_TASK_ROOT} --system --no-verify-hashes

# Copy the rest of the code
COPY . ${LAMBDA_TASK_ROOT}

FROM public.ecr.aws/lambda/python:${PYTHON_VERSION}

ENV HF_HOME=/tmp/transformers_cache

# Copy installed dependencies and application code from the builder stage
COPY --from=builder ${LAMBDA_TASK_ROOT} ${LAMBDA_TASK_ROOT}

# Copy the rest of the code
COPY . ${LAMBDA_TASK_ROOT}

# No need to configure the handler or entrypoint - SST will do that