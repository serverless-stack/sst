import os
import uuid
from flask import Flask, request, jsonify
import torch
from PIL import Image
import boto3
from sgm.inference.helpers import embed_watermark
from sgm.inference.api import (
    SamplingParams,
    SamplingPipeline,
    ModelArchitecture,
    get_sampler,
    get_model,
)

app = Flask(__name__)

# Initialize the model
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = get_model(ModelArchitecture.SVD, device=device)
sampler = get_sampler(device=device)
pipeline = SamplingPipeline(
    model=model,
    sampler=sampler,
    scheduler=model.scheduler,
)

# Initialize S3 client
s3_client = boto3.client('s3')

@app.route('/generate_video', methods=['POST'])
def generate_video():
    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400
    
    image_file = request.files['image']
    image = Image.open(image_file).convert("RGB")
    
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
    output = pipeline(
        image,
        params,
    )
    
    # Save the output video locally
    output_filename = f"{uuid.uuid4()}.mp4"
    output_path = f"/tmp/{output_filename}"
    embed_watermark(output[0]).save(output_path)
    
    # Upload to S3
    bucket_name = 'aws-ai-video-generation-frank-bucket-uhfextfm'
    s3_client.upload_file(output_path, bucket_name, output_filename)
    
    # Generate a presigned URL
    s3_url = s3_client.generate_presigned_url('get_object',
                                              Params={'Bucket': bucket_name,
                                                      'Key': output_filename},
                                              ExpiresIn=3600)
    
    # Clean up local file
    os.remove(output_path)
    
    return jsonify({'video_url': s3_url})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80)