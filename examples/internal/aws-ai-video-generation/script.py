import torch
from PIL import Image
from pathlib import Path
from sgm.inference.helpers import embed_watermark
from sgm.inference.api import (
    SamplingPipeline,
    ModelArchitecture,
    SamplingParams,
)
from sgm.inference.helpers import init_model

def main():
    # Set up device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # Initialize the model
    model = init_model(ModelArchitecture.SVD, device=device)
    pipeline = SamplingPipeline(model=model)

    # Load the input image
    input_image_path = "path/to/your/input/image.jpg"
    image = Image.open(input_image_path).convert("RGB")

    # Set sampling parameters
    params = SamplingParams(
        batch_size=1,
        height=576,
        width=1024,
        num_frames=14,
        motion_bucket_id=127,
        fps=6,
    )

    # Generate video
    print("Generating video...")
    output = pipeline(image, params)

    # Save the output video
    output_path = "output_video.mp4"
    embed_watermark(output[0]).save(output_path)
    print(f"Video saved to {output_path}")

if __name__ == "__main__":
    main()