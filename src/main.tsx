import { createYoga, createSchema } from 'graphql-yoga'
import { useDeferStream } from '@graphql-yoga/plugin-defer-stream'
import { Client, fetchExchange, gql, Provider, useQuery } from 'urql'
import { cacheExchange } from '@urql/exchange-graphcache'
import { getIntrospectionQuery } from 'graphql'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { devtoolsExchange } from '@urql/devtools'

const schema = createSchema({
  typeDefs: `
    type Item {
      id: String
      children: [Item!]!
      element: Element
    }

    type Element {
      id: String
      children: [Element]!
    }

    type Query {
      Item: Item!
    }

    schema {
      query: Query
    }
  `,
  resolvers: {
    Query: {
      Item: () => ({
        __typename: 'Item',
        id: 'parent:',
        async *children () {
          yield {
            __typename: 'Item',
            id: '2',
            bar: 'bar',
            children: [],
            element: {
              __typename: 'Element',
              id: '12',
              children: []
            }
          }
  
          await new Promise((resolve) => setTimeout(resolve, 1000))
  
          yield {
            __typename: 'Item',
            id: '3',
            bar: 'baz',
            children: [],
            element: {
              __typename: 'Element',
              id: '13',
              children: []
            }
          }
        },
        // element: {
        //   __typename: 'Element',
        //   id: 'parent:',
        //   children: []
        // }
      })
    }
  }
})


const yoga = createYoga({ schema, plugins: [useDeferStream()] })

const schemaData =
  await yoga
    .fetch(
      new Request(
        'http://d/graphql',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: {}, query: getIntrospectionQuery() })
        }
      ),
      {}
    )
    .then(res => res.json())
    .then(res => res.data)

const query = gql`
  query GetItem {
    Item {
      id
      children @stream {
        id
        element {
          id
        }
      }
      element {
        id
        children {
          id
        }
      }
    }
  }
`

const cache = cacheExchange({
  schema: schemaData,
  keys: {
    Item: (item) => {
      const childrenIds = item.children?.map(child => child.id)
      if (childrenIds?.length) return `parent:${childrenIds.join(',')}`
      return item.id
    },
    Element: (element) => {
      const childrenIds = element.children?.map(child => child.id)
      if (childrenIds?.length) return `parent:${childrenIds.join(',')}`
      return element.id
    }
  },
  updates: {
    Item: {
      children: (result, args, cache, info) => {
        if (!info.parentKey.includes('parent')) return
        if (!result.element) {
          result.element = {
            __typename: 'Element',
            id: info.parentKey.replace('Element:', ''),
            children: result.children.map(item => item.element)
          }
          return
        }
        result.element.children = result.children.map(item => item.element) ?? []
      }
    }
  },
  resolvers: {
    Item: {
      id: (data, args, cache, info) => {
        if (info.parentKey.includes('parent')) return info.parentKey.replace('Item:', '')
        return data.id
      }
    },
    Element: {
      id: (data, args, cache, info) => {
        if (info.parentKey.includes('parent')) return info.parentKey.replace('Element:', '')
        return data.id
      }
    }
  }
})

const client = new Client({
  url: 'http://d/graphql',
  exchanges: [devtoolsExchange, cache, fetchExchange],
  fetch: async (input: RequestInfo | URL, init?: RequestInit | undefined) => {
    const { body, headers } = await yoga.handleRequest(new Request(input, init), {})
    return new Response(body, { headers: Object.fromEntries(headers.entries()) })
  }
})

// WANTED RESULT IS 
// {
//   "Item": {
//     "id": "parent:2,3",
//     "children": [
//       {
//         "id": "2",
//         "element": {
//           "id": "12"
//         }
//       },
//       {
//         "id": "3",
//         "element": {
//           "id": "13"
//         }
//       }
//     ],
//     "element": {
//       "id": "parent:12,13",
//       "children": [{ "id": "12" }, { "id": "13" }]
//     }
//   }
// }

const App = () => {
  const [res] = useQuery({ query })
  console.log('res', res)
  if (res.fetching) {
    return <div>loading...</div>
  }

  if (res?.error) {
    console.error(res.error)
    return <pre>{res.error.stack}</pre>
  }

  return (
    <div>
      <pre>{JSON.stringify(res.data, null, 2)}</pre>
    </div>
  )
}

createRoot(document.querySelector('body')!.appendChild(document.createElement('div')))
  .render(
    <Provider value={client}>
      <App />
    </Provider>
  )
