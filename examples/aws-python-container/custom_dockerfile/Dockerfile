# The python version to use is supplied as an arg from SST
ARG PYTHON_VERSION=3.11

# Use an official AWS Lambda base image for Python
FROM public.ecr.aws/lambda/python:${PYTHON_VERSION}

# # Ensure git is installed so we can install git based dependencies (such as sst)
RUN yum update -y && \
    yum install -y git gcc && \
    yum clean all

# Install UV to manage your python runtime
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Install the dependencies to the lambda runtime
COPY requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN uv pip install -r requirements.txt --target ${LAMBDA_TASK_ROOT} --system

# Perform any steps that you want here:
# Example: pre-bake in model weights from huggingface to image

# Copy the rest of the code
COPY . ${LAMBDA_TASK_ROOT}

# No need to configure the handler or entrypoint - SST will do that