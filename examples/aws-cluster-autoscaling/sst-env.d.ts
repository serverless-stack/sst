/* This file is auto-generated by SST. Do not edit. */
/* tslint:disable */
/* eslint-disable */
/* deno-fmt-ignore-file */
import "sst"
export {}
declare module "sst" {
  export interface Resource {
    "MyQueue": {
      "type": "sst.aws.Queue"
      "url": string
    }
    "MyQueuePurger": {
      "name": string
      "type": "sst.aws.Function"
      "url": string
    }
    "MyQueueSeeder": {
      "name": string
      "type": "sst.aws.Function"
      "url": string
    }
    "MyService": {
      "service": string
      "type": "sst.aws.Service"
      "url": string
    }
    "MyVpc": {
      "type": "sst.aws.Vpc"
    }
  }
}
