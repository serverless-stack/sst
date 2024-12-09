// @ts-nocheck
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */

export type Scalars = {
    String: string,
    Boolean: boolean,
}


/** Long necks, cool patterns, taller than you. */
export interface Giraffe {
    name: Scalars['String']
    __typename: 'Giraffe'
}

export interface Mutation {
    createGiraffe: Giraffe
    __typename: 'Mutation'
}

export interface Query {
    giraffe: Giraffe
    __typename: 'Query'
}


/** Long necks, cool patterns, taller than you. */
export interface GiraffeGenqlSelection{
    name?: boolean | number
    __typename?: boolean | number
    __scalar?: boolean | number
}

export interface MutationGenqlSelection{
    createGiraffe?: (GiraffeGenqlSelection & { __args: {name: Scalars['String']} })
    __typename?: boolean | number
    __scalar?: boolean | number
}

export interface QueryGenqlSelection{
    giraffe?: GiraffeGenqlSelection
    __typename?: boolean | number
    __scalar?: boolean | number
}


    const Giraffe_possibleTypes: string[] = ['Giraffe']
    export const isGiraffe = (obj?: { __typename?: any } | null): obj is Giraffe => {
      if (!obj?.__typename) throw new Error('__typename is missing in "isGiraffe"')
      return Giraffe_possibleTypes.includes(obj.__typename)
    }
    


    const Mutation_possibleTypes: string[] = ['Mutation']
    export const isMutation = (obj?: { __typename?: any } | null): obj is Mutation => {
      if (!obj?.__typename) throw new Error('__typename is missing in "isMutation"')
      return Mutation_possibleTypes.includes(obj.__typename)
    }
    


    const Query_possibleTypes: string[] = ['Query']
    export const isQuery = (obj?: { __typename?: any } | null): obj is Query => {
      if (!obj?.__typename) throw new Error('__typename is missing in "isQuery"')
      return Query_possibleTypes.includes(obj.__typename)
    }
    