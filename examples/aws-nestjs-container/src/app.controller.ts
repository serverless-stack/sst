import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Resource } from 'sst';
import { Express } from 'express';
import { Upload } from '@aws-sdk/lib-storage';
import { FileInterceptor } from '@nestjs/platform-express';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Controller, Get, Post, Redirect, UploadedFile, UseInterceptors } from '@nestjs/common';
import { AppService } from './app.service';

const s3 = new S3Client({});

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File): Promise<string> {
    const params = {
      Bucket: Resource.MyBucket.name,
      ContentType: file.mimetype,
      Key: file.originalname,
      Body: file.buffer,
    };

    const upload = new Upload({
      params,
      client: s3,
    });

    await upload.done();

    return 'File uploaded successfully.';
  }

  @Get('latest')
  @Redirect('/', 302)
  async getLatestFile() {
    const objects = await s3.send(
      new ListObjectsV2Command({
        Bucket: Resource.MyBucket.name,
      }),
    );

    const latestFile = objects.Contents.sort(
      (a, b) => b.LastModified.getTime() - a.LastModified.getTime(),
    )[0];

    const command = new GetObjectCommand({
      Key: latestFile.Key,
      Bucket: Resource.MyBucket.name,
    });
    const url = await getSignedUrl(s3, command);

    return { url };
  }
}
