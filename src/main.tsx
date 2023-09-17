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
    type EpisodeEdge {
      node: Episode
    }

    type MediaEdge {
      node: Media
    }

    type EpisodeConnection {
      edges: [EpisodeEdge!]!
    }

    type MediaConnection {
      edges: [MediaEdge!]!
    }

    type Episode {
      uri: String
      handles: EpisodeConnection!
      media: Media
    }

    type Media {
      uri: String
      handles: MediaConnection!
    }

    type Page {
      episode: [Episode!]!
    }

    type Query {
      Page: Page!
    }

    schema {
      query: Query
    }
  `,
  resolvers: {
    Page: {
      episode: async () => ([{
        __typename: 'Episode',
        uri: 'scannarr:',
        handles: {
          __typename: 'EpisodeConnection',
          edges: [{
            node: {
              __typename: 'Episode',
              uri: '2',
              bar: 'bar',
              handles: {
                __typename: 'EpisodeConnection',
                edges: []
              },
              media: {
                __typename: 'Media',
                uri: '12'
              }
            }
          }]
        }
      }])
    },
    Query: {
      Page: () => ({})
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
  query GetEpisode {
    Page {
      episode {
        uri
        # Comment this
        media {
          uri
          handles {
            edges {
              node {
                uri
              }
            }
          }
        }
        # Up to here and
        handles {
          edges @stream {
            node {
              uri
              media {
                uri
              }
            }
          }
        }
        # Uncomment this to fix the issue
        # media {
        #   uri
        #   handles {
        #     edges {
        #       node {
        #         uri
        #       }
        #     }
        #   }
        # }
      }
    }
  }
`

const cache = cacheExchange({
  schema: schemaData,
  keys: {
    Page: () => null,
    Episode: (episode) => {
      const handlesIds = episode.handles?.edges.map(episodeEdge => episodeEdge.node.uri)
        if (handlesIds?.length) {
          console.log('KEY Episode', `scannarr:(${handlesIds.join(',')})`, episode)
          return `scannarr:(${handlesIds.join(',')})`
        }
      return episode.uri
    },
    Media: (media) => {
      const handlesIds = media.handles?.edges.map(mediaEdge => mediaEdge.node.uri)
      if (handlesIds?.length) {
          console.log('KEY Media', `scannarr:(${handlesIds.join(',')})`, media)
          return `scannarr:(${handlesIds.join(',')})`
      }
      return media.uri
    }
  },
  updates: {
    Episode: {
      handles: (result, args, cache, info) => {
        if (!info.parentKey.includes('scannarr')) return
        if (!result.media && result.handles?.edges.length) {
          result.media = {
            __typename: 'Media',
            uri: info.parentKey.replace('Media:', ''),
            handles: {
              __typename: 'MediaConnection',
              edges: result.handles.edges.map(episodeEdge => ({
                __typename: 'MediaEdge',
                node: episodeEdge.node.media
              }))
            }
          }
          return
        }
        if (result.media) {
          result.media.handles.edges =
            result.handles?.edges.map(episodeEdge => ({
              __typename: 'MediaEdge',
              node: episodeEdge.node.media
            }))
            ?? []
        }
      }
    }
  },
  resolvers: {
    Episode: {
      uri: (data, args, cache, info) => {
        if (info.parentKey.includes('scannarr')) return info.parentKey.replace('Episode:', '')
        return data.uri
      }
    },
    Media: {
      uri: (data, args, cache, info) => {
        if (info.parentKey.includes('scannarr')) return info.parentKey.replace('Media:', '')
        return data.uri
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
//   "Episode": {
//     "uri": "scannarr:2,3",
//     "handles": [
//       {
//         "uri": "2",
//         "media": {
//           "uri": "12"
//         }
//       },
//       {
//         "uri": "3",
//         "media": {
//           "uri": "13"
//         }
//       }
//     ],
//     "media": {
//       "uri": "scannarr:12,13",
//       "handles": [{ "uri": "12" }, { "uri": "13" }]
//     }
//   }
// }

const App = () => {
  const [res] = useQuery({ query })
  console.log('res', res.data?.Episode, res.data?.Episode?.media)
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
