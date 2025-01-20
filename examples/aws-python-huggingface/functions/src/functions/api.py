from transformers import pipeline
import json

# Initialize the pipeline once (outside the handler) to avoid reloading the model on each request
pipe = pipeline("text-generation", model="roneneldan/TinyStories-1M")


def handler(event, context):
    # Define the prompt for text generation
    prompt = "Write a short story about the magical framework SST that makes the cloud so easy to use!"

    # Generate text using the pipeline
    response = pipe(
        prompt,
        max_length=150,
        num_return_sequences=1,
        temperature=0.6,
        top_k=50,
        do_sample=True,
    )

    # Extract the generated text
    generated_text = response[0]["generated_text"]

    # Return the response with a status code and JSON-encoded body
    return {
        "statusCode": 200,
        "body": json.dumps({"story": generated_text}),
    }
