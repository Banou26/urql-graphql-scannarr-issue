import { createYoga, createSchema } from 'graphql-yoga'
import { Client, fetchExchange } from 'urql'
import { cacheExchange } from '@urql/exchange-graphcache'

const schema = createSchema({
  typeDefs: `
    type Foo {
      id: String
      bar: String
    }

     type Query {
      Foo: Foo
    }

    schema {
      query: Query
    }
  `,
  resolvers: {
    Query: {
      Foo: () => ({
        id: '1',
        bar: 'bar'
      })
    }
  }
})

const yoga = createYoga({ schema })

const cache = cacheExchange({
  keys: {
    Foo: (foo) => foo.id
  },
  resolvers: {
    Query: {
      Foo: (_, args, cache, info) => ({
        __typename: 'Foo',
        id: '2',
        // UNCOMMENT THIS LINE TO FIX THE ISSUE
        // bar: null
      })
    }
  }
})

const client = new Client({
  url: 'http://d/graphql',
  exchanges: [cache, fetchExchange],
  fetch: async (input: RequestInfo | URL, init?: RequestInit | undefined) => {
    const { body, headers } = await yoga.handleRequest(new Request(input, init), {})
    return new Response(body, { headers: Object.fromEntries(headers.entries()) })
  }
})

client
  .query(`
    query {
      Foo {
        id
        bar
      }
    }
  `)
  .toPromise()
  .then(res => {
    console.log('res', res)
  })
