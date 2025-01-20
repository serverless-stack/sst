# ❍ Using Hugging Face Models with Python

Deploy lightweight huggingface models using sst on AWS Lambda.

This example uses the [transformers](https://github.com/huggingface/transformers) library to generate text using the [TinyStories-33M](https://huggingface.co/roneneldan/TinyStories-33M) model. The backend is the pytorch cpu runtime. This example also shows how it is possible to use custom index resolution to get dependencies from a private pypi server such as the pytorch cpu link. This example also shows how to use a custom Dockerfile to handle complex builds such as installing pytorch and pruning the build size.

Note that this is not a production ready example.