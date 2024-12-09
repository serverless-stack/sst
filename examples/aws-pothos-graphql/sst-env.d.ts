/* tslint:disable */
/* eslint-disable */
import "sst"
declare module "sst" {
  export interface Resource {
    Client: {
      name: string
      type: "sst.aws.Function"
      url: string
    }
    PothosGraphql: {
      name: string
      type: "sst.aws.Function"
      url: string
    }
  }
}
export {}
