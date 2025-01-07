/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-ai-video-generation",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const bucket = new sst.aws.Bucket(`Bucket`);
    const apiServer = new aws.s3.BucketObject(`ApiServer`, {
      bucket: bucket.name,
      key: "api_server.py",
      source: $asset("api_server.py"),
    });

    const vpc = new sst.aws.Vpc(`Vpc`);
    const sg = new aws.ec2.SecurityGroup(`SecurityGroup`, {
      vpcId: vpc.id,
      ingress: [
        {
          protocol: "tcp",
          fromPort: 22,
          toPort: 22,
          cidrBlocks: ["0.0.0.0/0"],
        },
        {
          protocol: "tcp",
          fromPort: 80,
          toPort: 80,
          cidrBlocks: ["0.0.0.0/0"],
        },
      ],
      egress: [
        {
          protocol: "-1",
          fromPort: 0,
          toPort: 0,
          cidrBlocks: ["0.0.0.0/0"],
        },
      ],
    });

    const role = new aws.iam.Role(`Role`, {
      assumeRolePolicy: aws.iam.getPolicyDocumentOutput({
        statements: [
          {
            actions: ["sts:AssumeRole"],
            principals: [
              {
                type: "Service",
                identifiers: ["ec2.amazonaws.com"],
              },
            ],
          },
        ],
      }).json,
      managedPolicyArns: [
        "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
      ],
      inlinePolicies: [
        {
          name: "inline",
          policy: aws.iam.getPolicyDocumentOutput({
            statements: [
              {
                actions: ["s3:*"],
                resources: [bucket.arn, $interpolate`${bucket.arn}/*`],
              },
            ],
          }).json,
        },
      ],
    });
    const instanceProfile = new aws.iam.InstanceProfile(`InstanceProfile`, {
      role: role.name,
    });

    // Select DLAMIs https://docs.aws.amazon.com/dlami/latest/devguide/appendix-ami-release-notes.html
    const instance = new aws.ec2.Instance(`InstanceB`, {
      instanceType: "g4dn.xlarge",
      ami: "ami-00ca14132c418aba6", // DLAMI x86 PyTorch 2.2 w/ Python 3.10
      vpcSecurityGroupIds: [sg.id],
      subnetId: vpc.publicSubnets.apply((subnets) => subnets[0]),
      iamInstanceProfile: instanceProfile.name,

      /*
sudo -i -u ubuntu
cd /opt/dlami/nvme
sudo apt-get install git-lfs
screen
*/
      userData: $interpolate`
#!/bin/bash -xe

# Create a directory for the project
mkdir -p svd_project
cd svd_project

# Clone the repository
git clone https://github.com/Stability-AI/generative-models.git
cd generative-models
pip install -r requirements/pt2.txt
pip install .
pip install -e git+https://github.com/Stability-AI/datapipelines.git@main#egg=sdata

huggingface-cli login --token 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
huggingface-cli download stabilityai/sv4d --include sv4d.safetensors --cache-dir cache
huggingface-cli download stabilityai/sv3d --include sv3d_u.safetensors --cache-dir cache

mkdir -p checkpoints
mv cache/models--stabilityai--sv4d/blobs/bdfe5bb33dfc771fc102891883befcf061873f4a96fa602037a964beca83cb44 checkpoints/sv4d.safetensors
mv cache/models--stabilityai--sv3d/blobs/d2c281b817232c492f6db27c9ce597b543187c52229cbad2a3c78e238b06c809 checkpoints/sv3d_u.safetensors

pip install --force-reinstall -v "numpy==1.25.2"
pip install imageio-ffmpeg
python scripts/sampling/simple_video_sample_4d.py --input_path assets/sv4d_videos/test_video1.mp4 --output_folder outputs/sv4d

# export PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:128
# change: reduce decode_t in scripts/sampling/simple_video_sample_4d.py
# change: set lowvram_mode = True in scripts/demo/streamlit_helpers.py
`,
      // Questions
      // - how to know if GPU is being used?
      // - what are safetensors?
      // - what is the datapipelines package?
      // - what are the relationships between the generative-models repo, the datapipelines package, and the safetensors files?
      // - what are checkpoints?
    });

    return {
      bucket: bucket.name,
      instance: instance.id,
      url: $interpolate`http://${instance.publicIp}:80`,
    };
  },
});
