import React, { createContext, useContext, useReducer, useMemo, useCallback, useEffect, useState } from 'react'
import { usePairData } from './PairData'
import { client } from '../apollo/client'
import {
  USER_TRANSACTIONS,
  USER_POSITIONS,
  USER_HISTORY,
  USER_HISTORY__PER_PAIR,
  PAIR_DAY_DATA_BULK,
  FIRST_SNAPSHOT,
  POSITIONS_BY_BLOCK
} from '../apollo/queries'
import { useTimeframe, useStartTimestamp, DEFAULT_TIMESTAMP } from './Application'
import { timeframeOptions } from '../constants'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import { useEthPrice } from './GlobalData'
import { ETH, getShareValueOverTime } from '../helpers'
import { getTimeframe, getBlocksFromTimestamps } from '../utils'
import { getLPReturnsOnPair, getHistoricalPairReturns } from '../utils/returns'


dayjs.extend(utc)

const UPDATE_TRANSACTIONS = 'UPDATE_TRANSACTIONS'
const UPDATE_POSITIONS = 'UPDATE_POSITIONS '
const UPDATE_USER_POSITION_HISTORY = 'UPDATE_USER_POSITION_HISTORY'
const UPDATE_USER_PAIR_HODLS_RETURNS = 'UPDATE_USER_PAIR_HODLS_RETURNS'

const TRANSACTIONS_KEY = 'TRANSACTIONS_KEY'
const POSITIONS_KEY = 'POSITIONS_KEY'
const USER_SNAPSHOTS = 'USER_SNAPSHOTS'
const USER_PAIR_RETURNS_KEY = 'USER_PAIR_RETURNS_KEY'
const USER_POSITION_HISTORY_KEY = 'USER_POSITION_HISTORY_KEY'
const USER_PAIR_HODLS_RETURNS_KEY = 'USER_PAIR_HODLS_RETURNS_KEY'
const UPDATE_USER_PAIR_RETURNS = 'UPDATE_USER_PAIR_RETURNS'

const UserContext = createContext()

function useUserContext() {
  return useContext(UserContext)
}

/**
 * For a given position (data about holding) and user, get the chart
 * data for the fees and liquidity over time
 * @param {*} position
 * @param {*} account
 */
export function useUserPositionChart(position, account) {
  const pairAddress = position?.pair?.id
  const [state, { updateUserPairReturns }] = useUserContext()

  // get oldest date of data to fetch
  const startDateTimestamp = useStartTimestamp()

  // get users adds and removes on this pair
  const snapshots = useUserSnapshots(account)
  const pairSnapshots =
    snapshots &&
    position &&
    snapshots.filter(currentSnapshot => {
      return currentSnapshot.pair.id === position.pair.id
    })

  // get data needed for calculations
  const currentPairData = usePairData(pairAddress)
  const [currentETHPrice] = useEthPrice()

  // formatetd array to return for chart data
  const formattedHistory = state?.[account]?.[USER_PAIR_RETURNS_KEY]?.[pairAddress]

  useEffect(() => {
    async function fetchData() {
      let fetchedData = await getHistoricalPairReturns(
        startDateTimestamp,
        currentPairData,
        pairSnapshots,
        currentETHPrice
      )
      updateUserPairReturns(account, pairAddress, fetchedData)
    }
    if (
      account &&
      startDateTimestamp &&
      pairSnapshots &&
      !formattedHistory &&
      currentPairData &&
      Object.keys(currentPairData).length > 0 &&
      pairAddress &&
      currentETHPrice
    ) {
      fetchData()
    }
  }, [
    account,
    startDateTimestamp,
    pairSnapshots,
    formattedHistory,
    pairAddress,
    currentPairData,
    currentETHPrice,
    updateUserPairReturns,
    position.pair.id
  ])

  return formattedHistory
}


function reducer(state, { type, payload }) {
  switch (type) {
    case UPDATE_TRANSACTIONS: {
      const { account, transactions } = payload
      return {
        ...state,
        [account]: {
          ...state?.[account],
          [TRANSACTIONS_KEY]: transactions
        }
      }
    }
    case UPDATE_POSITIONS: {
      const { account, positions } = payload
      return {
        ...state,
        [account]: { ...state?.[account], [POSITIONS_KEY]: positions }
      }
    }

    case UPDATE_USER_POSITION_HISTORY: {
      const { account, historyData } = payload
      return {
        ...state,
        [account]: { ...state?.[account], [USER_SNAPSHOTS]: historyData }
      }
    }

    case UPDATE_USER_PAIR_RETURNS: {
      const { account, pairAddress, data } = payload
      return {
        ...state,
        [account]: {
          ...state?.[account],
          [USER_PAIR_RETURNS_KEY]: {
            ...state?.[account]?.[USER_PAIR_RETURNS_KEY],
            [pairAddress]: data
          }
        }
      }
    }

    default: {
      throw Error(`Unexpected action type in DataContext reducer: '${type}'.`)
    }
  }
}

const INITIAL_STATE = {}


export default function Provider({ children }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)

  const updateTransactions = useCallback((account, transactions) => {
    dispatch({
      type: UPDATE_TRANSACTIONS,
      payload: {
        account,
        transactions
      }
    })
  }, [])

  const updatePositions = useCallback((account, positions) => {
    dispatch({
      type: UPDATE_POSITIONS,
      payload: {
        account,
        positions
      }
    })
  }, [])

  const updateUserSnapshots = useCallback((account, historyData) => {
    dispatch({
      type: UPDATE_USER_POSITION_HISTORY,
      payload: {
        account,
        historyData
      }
    })
  }, [])

  const updateUserPositionHistory = useCallback((account, historyData) => {
    dispatch({
      type: UPDATE_USER_POSITION_HISTORY,
      payload: {
        account,
        historyData
      }
    })
  }, [])

  const updateUserHodlReturns = useCallback((account, hodlData) => {
    dispatch({
      type: UPDATE_USER_PAIR_HODLS_RETURNS,
      payload: {
        account,
        hodlData
      }
    })
  }, [])

  const updateUserPairReturns = useCallback((account, pairAddress, data) => {
    dispatch({
      type: UPDATE_USER_PAIR_RETURNS,
      payload: {
        account,
        pairAddress,
        data
      }
    })
  }, [])

  return (
    <UserContext.Provider
      value={useMemo(
        () => [state, { updateTransactions, updatePositions, updateUserPositionHistory, updateUserHodlReturns, updateUserSnapshots, updateUserPairReturns }],
        [state, updateTransactions, updatePositions, updateUserPositionHistory, updateUserHodlReturns, updateUserSnapshots, updateUserPairReturns]
      )}
    >
      {children}
    </UserContext.Provider>
  )
}

export function useUserTransactions(account) {
  const [state, { updateTransactions }] = useUserContext()
  const transactions = state?.[account]?.[TRANSACTIONS_KEY]
  useEffect(() => {
    async function fetchData(account) {
      try {
        let result = await client.query({
          query: USER_TRANSACTIONS,
          variables: {
            user: account
          },
          fetchPolicy: 'no-cache'
        })
        if (result?.data) {
          updateTransactions(account, result?.data)
        }
      } catch (e) {
        console.log(e)
      }
    }
    if (!transactions && account) {
      fetchData(account)
    }
  }, [account, transactions, updateTransactions])

  return transactions || {}
}

export function useReturnsPerPairHistory(position, account) {
  const [state] = useUserContext()
  const history = state?.[account]?.[USER_POSITION_HISTORY_KEY]

  const pairSnapshots =
    history &&
    position &&
    history.filter(currentPosition => {
      return currentPosition.pair.id === position.pair.id
    })

  // formatetd array to return for chart data
  const [formattedHistory, setFormattedHistory] = useState()

  const [startDateTimestamp, setStartDateTimestamp] = useState()
  const [activeWindow] = useTimeframe()

  const pairAddress = position?.pair?.id

  const currentPairData = usePairData(pairAddress)
  const currentETHPrice = useEthPrice()

  // monitor the old date fetched
  useEffect(() => {
    const utcEndTime = dayjs.utc()
    // based on window, get starttime
    let utcStartTime
    switch (activeWindow) {
      case timeframeOptions.WEEK:
        utcStartTime = utcEndTime.subtract(1, 'week').startOf('day')
        break
      case timeframeOptions.ALL_TIME:
        utcStartTime = utcEndTime.subtract(1, 'year')
        break
      default:
        utcStartTime = utcEndTime.subtract(1, 'year').startOf('year')
        break
    }
    let startTime = utcStartTime.unix() - 1
    if ((activeWindow && startTime < startDateTimestamp) || !startDateTimestamp) {
      setStartDateTimestamp(startTime)
    }
  }, [activeWindow, startDateTimestamp])

  useEffect(() => {
    async function fetchData() {
      let dayIndex = parseInt(startDateTimestamp / 86400) // get unique day bucket unix
      const currentDayIndex = parseInt(dayjs.utc().unix() / 86400)
      // sort snapshots in order
      let sortedPositions = history.sort((a, b) => {
        return parseInt(a.timestamp) > parseInt(b.timestamp) ? 1 : -1
      })
      // if UI start time is > first position time - bump start index to this time
      if (parseInt(sortedPositions[0].timestamp) > dayIndex) {
        dayIndex = parseInt(parseInt(sortedPositions[0].timestamp) / 86400)
      }

      const dayTimestamps = []
      // get date timestamps for all days in view
      while (dayIndex <= currentDayIndex) {
        dayTimestamps.push(parseInt(dayIndex) * 86400)
        dayIndex = dayIndex + 1
      }

      const shareValues = await getShareValueOverTime(pairAddress, dayTimestamps)

      const formattedHistory = []

      // map of current pair => ownership %
      let returns = {
        lastUpdated: pairSnapshots[0].timestamp,
        liquidityTokenBalance: parseFloat(pairSnapshots[0].liquidityTokenBalance),
        totalSupply: parseFloat(pairSnapshots[0].liquidityTokenTotalSupply),
        reserve0: parseFloat(pairSnapshots[0].reserve0),
        reserve1: parseFloat(pairSnapshots[0].reserve1),
        reserveUSD: parseFloat(pairSnapshots[0].reserveUSD),
        token0PriceUSD: parseFloat(pairSnapshots[0].token0PriceUSD),
        token1PriceUSD: parseFloat(pairSnapshots[0].token1PriceUSD),
        assetReturn: 0,
        mooniswapReturn: 0,
        netReturn: 0,
        assetChange: 0,
        mooniswapChange: 0,
        netChange: 0
      }

      for (const index in dayTimestamps) {
        const dayTimestamp = dayTimestamps[index]
        const timestampCeiling = dayTimestamp + 86400

        const shareValue = shareValues[index]

        const positionT0 = returns
        let positionT1 = shareValue

        // if today , use latest data
        if (parseInt(index) === dayTimestamps.length - 1) {
          positionT1 = currentPairData
          positionT1.timestamp = shareValue.timestamp
          positionT1.ethPrice = currentETHPrice
          positionT1.token0DerivedETH = currentPairData.token0.derivedETH
          positionT1.token1DerivedETH = currentPairData.token1.derivedETH
          positionT1.totalSupply = currentPairData.totalSupply
        }

        positionT1.token0PriceUSD = parseFloat(positionT1.ethPrice) * parseFloat(positionT1.token0DerivedETH)
        positionT1.token1PriceUSD = parseFloat(positionT1.ethPrice) * parseFloat(positionT1.token1DerivedETH)

        // get position changes on this day
        const positionChanges = pairSnapshots?.filter(snapshot => {
          return snapshot.timestamp < timestampCeiling && snapshot.timestamp > dayTimestamp
        })

        let needsUpdate = false
        // find latest change, and use that as end of window for today
        for (const index in positionChanges) {
          const positionChange = positionChanges[index]
          // case where more recent timestamp is found for pair
          if (returns.lastUpdated < positionChange.timestamp) {
            returns.lastUpdated = positionChange.timestamp
            positionT1 = positionChange
            positionT1.totalSupply = positionChange.liquidityTokenTotalSupply
            needsUpdate = true
          }
        }

        // calculate ownership at ends of window, for end of window we need original LP token balance / new total supply
        const t0Ownership = parseFloat(positionT0.liquidityTokenBalance) / parseFloat(positionT0.totalSupply)
        const t1Ownership = parseFloat(positionT0.liquidityTokenBalance) / parseFloat(positionT1.totalSupply)

        // get starting amounts of token0 and token1 deposited by LP
        const token0_amount_t0 = t0Ownership * parseFloat(positionT0.reserve0)
        const token1_amount_t0 = t0Ownership * parseFloat(positionT0.reserve1)

        // get current token values
        const token0_amount_t1 = t1Ownership * parseFloat(positionT1.reserve0)
        const token1_amount_t1 = t1Ownership * parseFloat(positionT1.reserve1)

        // calculate squares to find imp loss and fee differences
        const sqrK_t0 = Math.sqrt(token0_amount_t0 * token1_amount_t0)
        const token0_amount_no_fees = sqrK_t0 * Math.sqrt(positionT1.token1PriceUSD)
        const token1_amount_no_fees = sqrK_t0 / Math.sqrt(positionT1.token1PriceUSD)
        const no_fees_usd =
          token0_amount_no_fees * positionT1.token0PriceUSD + token1_amount_no_fees * positionT1.token1PriceUSD

        const difference_fees_token0 = token0_amount_t1 - token0_amount_no_fees
        const difference_fees_token1 = token1_amount_t1 - token1_amount_no_fees
        const difference_fees_usd =
          difference_fees_token0 * positionT1.token0PriceUSD + difference_fees_token1 * positionT1.token1PriceUSD

        // calculate USD value at t0 and t1 using initial token deposit amounts for asset return
        const assetValueT0 =
          token0_amount_t0 * parseFloat(positionT0.token0PriceUSD) +
          token1_amount_t0 * parseFloat(positionT0.token1PriceUSD)

        const assetValueT1 =
          token0_amount_t0 * parseFloat(positionT1.token0PriceUSD) +
          token1_amount_t0 * parseFloat(positionT1.token1PriceUSD)

        const imp_loss_usd = no_fees_usd - assetValueT1
        const mooniswap_return = difference_fees_usd + imp_loss_usd

        // calculate value delta based on  prices_t1 - prices_t0 * token_amounts
        const assetReturn = assetValueT1 - assetValueT0

        // get net value change for combined data
        const netValueT0 = t0Ownership * parseFloat(positionT0.reserveUSD)
        const netValueT1 = t1Ownership * parseFloat(positionT1.reserveUSD)

        // account for profits or loss because position actually changed here
        if (needsUpdate) {
          returns.netReturn = returns.netReturn + netValueT1 - netValueT0
          returns.assetReturn = returns.assetReturn + assetReturn
          returns.mooniswapReturn = returns.mooniswapReturn + mooniswap_return
          returns.netChange = returns.netChange + ((netValueT1 - netValueT0) / netValueT0) * 100
          returns.assetChange = returns.assetChange + (assetReturn / assetValueT0) * 100
        }

        const localNetReturn = returns.netReturn + netValueT1 - netValueT0
        const localAssetReturn = returns.assetReturn + assetReturn
        const localUnsiwapReturn = returns.mooniswapReturn + mooniswap_return

        // calculate the weighted percent changes for each metric
        const localAssetChange = (assetReturn / assetValueT0) * 100
        const localNetChange = ((netValueT1 - netValueT0) / netValueT0) * 100
        const localMooniswapChange = localNetChange - localAssetChange

        const currentLiquidityValue =
          parseFloat(positionT0.liquidityTokenBalance) * parseFloat(positionT1.sharePriceUsd)

        formattedHistory.push({
          date: dayTimestamp,
          usdValue: currentLiquidityValue,
          netReturn: localNetReturn,
          assetReturn: localAssetReturn,
          mooniswapReturn: localUnsiwapReturn,
          netChange: localNetChange,
          assetChange: localAssetChange,
          mooniswapChange: localMooniswapChange
        })
      }

      setFormattedHistory(formattedHistory)
    }
    if (
      history &&
      startDateTimestamp &&
      pairSnapshots &&
      !formattedHistory &&
      currentPairData &&
      pairAddress &&
      currentETHPrice
    ) {
      fetchData()
    }
  }, [history, startDateTimestamp, pairSnapshots, formattedHistory, pairAddress, currentPairData, currentETHPrice])

  return formattedHistory
}

export function useUserLiquidityHistory(account) {
  const [state, { updateUserPositionHistory }] = useUserContext()
  const history = state?.[account]?.[USER_POSITION_HISTORY_KEY]
  // formatetd array to return for chart data
  const [formattedHistory, setFormattedHistory] = useState()

  const [startDateTimestamp, setStartDateTimestamp] = useState()
  const [activeWindow] = useTimeframe()

  // monitor the old date fetched
  useEffect(() => {
    const utcEndTime = dayjs.utc()
    // based on window, get starttime
    let utcStartTime
    switch (activeWindow) {
      case timeframeOptions.WEEK:
        utcStartTime = utcEndTime.subtract(1, 'week').startOf('day')
        break
      case timeframeOptions.ALL_TIME:
        utcStartTime = utcEndTime.subtract(1, 'year')
        break
      default:
        utcStartTime = utcEndTime.subtract(1, 'year').startOf('year')
        break
    }
    let startTime = utcStartTime.unix() - 1
    if ((activeWindow && startTime < startDateTimestamp) || !startDateTimestamp) {
      setStartDateTimestamp(startTime)
    }
  }, [activeWindow, startDateTimestamp])

  useEffect(() => {
    async function fetchData() {
      try {
        let result = await client.query({
          query: USER_HISTORY,
          variables: {
            user: account
          },
          fetchPolicy: 'cache-first'
        })
        if (result) {
          updateUserPositionHistory(account, result.data.liquidityPositionSnapshots)
        }
      } catch (e) {
        console.log(e)
      }
    }
    if (!history && account && startDateTimestamp) {
      fetchData()
    }
  }, [account, startDateTimestamp, history, updateUserPositionHistory])

  useEffect(() => {
    async function fetchData() {
      let dayIndex = parseInt(startDateTimestamp / 86400) // get unique day bucket unix
      const currentDayIndex = parseInt(dayjs.utc().unix() / 86400)
      // sort snapshots in order
      let sortedPositions = history.sort((a, b) => {
        return parseInt(a.timestamp) > parseInt(b.timestamp) ? 1 : -1
      })
      // if UI start time is > first position time - bump start index to this time
      if (parseInt(sortedPositions[0].timestamp) > dayIndex) {
        dayIndex = parseInt(parseInt(sortedPositions[0].timestamp) / 86400)
      }

      const dayTimestamps = []
      // get date timestamps for all days in view
      while (dayIndex < currentDayIndex) {
        dayTimestamps.push(parseInt(dayIndex) * 86400)
        dayIndex = dayIndex + 1
      }

      const pairs = history.reduce((pairList, position) => {
        return [...pairList, position.pair.id]
      }, [])

      // get all day datas where date is in this list, and pair is in pair list
      let {
        data: { pairDayDatas }
      } = await client.query({
        query: PAIR_DAY_DATA_BULK(pairs, startDateTimestamp)
      })

      const formattedHistory = []

      // map of current pair => ownership %
      const ownershipPerPair = {}
      for (const index in dayTimestamps) {
        const dayTimestamp = dayTimestamps[index]
        const timestampCeiling = dayTimestamp + 86400

        // cycle through relevant positions and update ownership for any that we need to
        const relevantPositions = history.filter(snapshot => {
          return snapshot.timestamp < timestampCeiling && snapshot.timestamp > dayTimestamp
        })
        for (const index in relevantPositions) {
          const position = relevantPositions[index]
          // case where pair not added yet
          if (!ownershipPerPair[position.pair.id]) {
            ownershipPerPair[position.pair.id] = {
              lpTokenBalance: position.liquidityTokenBalance,
              timestamp: position.timestamp
            }
          }
          // case where more recent timestamp is found for pair
          if (ownershipPerPair[position.pair.id] && ownershipPerPair[position.pair.id].timestamp < position.timestamp) {
            ownershipPerPair[position.pair.id] = {
              lpTokenBalance: position.liquidityTokenBalance,
              timestamp: position.timestamp
            }
          }
        }

        const relavantDayDatas = Object.keys(ownershipPerPair).map(pairAddress => {
          // find last day data after timestamp update
          const dayDatasForThisPair = pairDayDatas.filter(dayData => {
            return dayData.pairAddress === pairAddress
          })
          // find the most recent reference to pair liquidity data
          let mostRecent = dayDatasForThisPair[0]
          for (const index in dayDatasForThisPair) {
            const dayData = dayDatasForThisPair[index]
            if (dayData.date < dayTimestamp && dayData.date > mostRecent.date) {
              mostRecent = dayData
            }
          }
          return mostRecent
        })

        // now cycle through pair day datas, for each one find usd value = ownership[address] * reserveUSD
        const dailyUSD = relavantDayDatas.reduce((totalUSD, dayData) => {
          return (totalUSD =
            totalUSD +
            (ownershipPerPair[dayData.pairAddress]
              ? (parseFloat(ownershipPerPair[dayData.pairAddress].lpTokenBalance) / parseFloat(dayData.totalSupply)) *
                parseFloat(dayData.reserveUSD)
              : 0))
        }, 0)

        formattedHistory.push({
          date: dayTimestamp,
          valueUSD: dailyUSD
        })
      }

      setFormattedHistory(formattedHistory)
    }
    if (history && startDateTimestamp) {
      fetchData()
    }
  }, [history, startDateTimestamp])

  return formattedHistory
}

export const priceOverrides = [
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0x6b175474e89094c44da98b954eedeac495271d0f' // DAI
]

/**
 *
 * deprecated
 */
export async function getReturns(user, pair, ethPrice) {
  const {
    data: { liquidityPositionSnapshots: history }
  } = await client.query({
    query: USER_HISTORY__PER_PAIR,
    variables: {
      user,
      pair: pair.id
    }
  })

  // asset return
  let assetReturn = 0
  let assetPercentChange = 0

  // net return
  let netReturn = 0
  let netPercentChange = 0

  // get data about the current position
  const currentPosition = {
    liquidityTokenBalance: history[history.length - 1].liquidityTokenBalance,
    liquidityTokenTotalSupply: pair.totalSupply,
    reserve0: pair.reserve0,
    reserve1: pair.reserve1,
    reserveUSD: pair.reserveUSD,
    token0PriceUSD: pair.token0.derivedETH * ethPrice,
    token1PriceUSD: pair.token1.derivedETH * ethPrice
  }

  // calculate the total USD amount provided to use for weighting
  let totalAmountProvidedUSD = 0
  for (const index in history) {
    let positionT0 = history[index]
    totalAmountProvidedUSD =
      totalAmountProvidedUSD +
      (parseFloat(positionT0.liquidityTokenBalance) / parseFloat(positionT0.liquidityTokenTotalSupply)) *
        parseFloat(positionT0.reserveUSD)
  }

  for (const index in history) {
    // get positions at both bounds of the window
    let positionT0 = history[index]
    let positionT1 = history[parseInt(index) + 1] || {}

    // if at last index in history - use current data as end of window
    if (parseInt(index) === history.length - 1) {
      positionT1 = currentPosition
    }

    // hard code prices before launch to get better results for stablecoins and WETH
    if (positionT0.timestamp < 1597093302) {
      if (priceOverrides.includes(positionT0.pair.token0.id)) {
        positionT0.token0PriceUSD = 1
      }
      if (priceOverrides.includes(positionT0.pair.token1.id)) {
        positionT0.token1PriceUSD = 1
      }

      // WETH price
      if (positionT0.pair.token0.id === ETH) {
        positionT0.token0PriceUSD = 395.84
      }
      if (positionT0.pair.token1.id === ETH) {
        positionT0.token1PriceUSD = 395.84
      }
    }
    if (positionT1.timestamp < 1597093302) {
      if (priceOverrides.includes(positionT1.pair.token0.id)) {
        positionT1.token0PriceUSD = 1
      }
      if (priceOverrides.includes(positionT1.pair.token1.id)) {
        positionT1.token1PriceUSD = 1
      }
      // WETH price
      if (positionT1.pair.token0.id === ETH) {
        positionT1.token0PriceUSD = 395.84
      }
      if (positionT1.pair.token1.id === ETH) {
        positionT1.token1PriceUSD = 395.84
      }
    }

    // calculate ownership at ends of window, for end of window we need original LP token balance / new total supply
    const t0Ownership = parseFloat(positionT0.liquidityTokenBalance) / parseFloat(positionT0.liquidityTokenTotalSupply)
    const t1Ownership = parseFloat(positionT0.liquidityTokenBalance) / parseFloat(positionT1.liquidityTokenTotalSupply)

    // get starting amounts of token0 and token1 deposited by LP
    const token0_amount_t0 = t0Ownership * parseFloat(positionT0.reserve0)
    const token1_amount_t0 = t0Ownership * parseFloat(positionT0.reserve1)

    // // get current token values
    // const token0_amount_t1 = t1Ownership * parseFloat(positionT1.reserve0)
    // const token1_amount_t1 = t1Ownership * parseFloat(positionT1.reserve1)

    // // calculate squares to find imp loss and fee differences
    // const sqrK_t0 = Math.sqrt(token0_amount_t0 * token1_amount_t0)
    // const token0_amount_no_fees = sqrK_t0 * Math.sqrt(positionT1.token1PriceUSD)
    // const token1_amount_no_fees = sqrK_t0 / Math.sqrt(positionT1.token1PriceUSD)
    // const no_fees_usd =
    //   token0_amount_no_fees * positionT1.token0PriceUSD + token1_amount_no_fees * positionT1.token1PriceUSD

    // const difference_fees_token0 = token0_amount_t1 - token0_amount_no_fees
    // const difference_fees_token1 = token1_amount_t1 - token1_amount_no_fees
    // const difference_fees_usd =
    //   difference_fees_token0 * positionT1.token0PriceUSD + difference_fees_token1 * positionT1.token1PriceUSD

    // calculate USD value at t0 and t1 using initial token deposit amounts for asset return
    const assetValueT0 =
      token0_amount_t0 * parseFloat(positionT0.token0PriceUSD) +
      token1_amount_t0 * parseFloat(positionT0.token1PriceUSD)

    const assetValueT1 =
      token0_amount_t0 * parseFloat(positionT1.token0PriceUSD) +
      token1_amount_t0 * parseFloat(positionT1.token1PriceUSD)

    // const imp_loss_usd = no_fees_usd - assetValueT1
    // const mooniswap_return = difference_fees_usd + imp_loss_usd

    // calculate value delta based on  prices_t1 - prices_t0 * token_amounts
    const assetValueChange = assetValueT1 - assetValueT0
    assetReturn = assetReturn ? assetReturn + assetValueChange : assetValueChange

    // get net value change for combined data
    const netValueT0 = t0Ownership * parseFloat(positionT0.reserveUSD)
    const netValueT1 = t1Ownership * parseFloat(positionT1.reserveUSD)
    netReturn = netReturn ? netReturn + netValueT1 - netValueT0 : netValueT1 - netValueT0

    // calculate the weight of this interval based on position ratio to total supplied
    const weight = (t0Ownership * parseFloat(positionT0.reserveUSD)) / totalAmountProvidedUSD

    // calculate the weighted percent changes for each metric
    const weightedAssetChange = ((weight * assetValueChange) / assetValueT0) * 100
    const wieghtedNetChange = ((weight * (netValueT1 - netValueT0)) / netValueT0) * 100

    // update the global percent changes
    assetPercentChange = assetPercentChange ? assetPercentChange + weightedAssetChange : weightedAssetChange
    netPercentChange = netPercentChange ? netPercentChange + wieghtedNetChange : wieghtedNetChange
  }

  // mooniswap specific return
  let mooniswapReturn = netReturn - assetReturn
  let mooniswapPercentChange = netPercentChange - assetPercentChange

  return {
    asset: {
      return: assetReturn,
      percent: assetPercentChange
    },
    net: {
      return: netReturn,
      percent: netPercentChange
    },
    mooniswap: {
      return: mooniswapReturn,
      percent: mooniswapPercentChange
    }
  }
}

/**
 * Store all the snapshots of liquidity activity for this account.
 * Each snapshot is a moment when an LP position was created or updated.
 * @param {*} account
 */
export function useUserSnapshots(account) {
  const [state, { updateUserSnapshots }] = useUserContext()
  const snapshots = state?.[account]?.[USER_SNAPSHOTS]

  useEffect(() => {
    async function fetchData() {
      try {
        let skip = 0
        let allResults = []
        let found = false
        while (!found) {
          let result = await client.query({
            query: USER_HISTORY,
            variables: {
              skip: skip,
              user: account
            },
            fetchPolicy: 'cache-first'
          })
          allResults = allResults.concat(result.data.liquidityPositionSnapshots)
          if (result.data.liquidityPositionSnapshots.length < 1000) {
            found = true
          } else {
            skip += 1000
          }
        }
        if (allResults) {
          updateUserSnapshots(account, allResults)
        }
      } catch (e) {
        console.log(e)
      }
    }
    if (!snapshots && account) {
      fetchData()
    }
  }, [account, snapshots, updateUserSnapshots])

  return snapshots
}


// export function useUserPositions(account) {
//   const [state, { updatePositions, updateUserHodlReturns }] = useUserContext()
//   const positions = state?.[account]?.[POSITIONS_KEY]
//   const [ethPrice] = useEthPrice()
//
//   useEffect(() => {
//     async function fetchData(account) {
//       try {
//         let result = await client.query({
//           query: USER_POSITIONS,
//           variables: {
//             user: account
//           },
//           fetchPolicy: 'no-cache'
//         })
//         if (result?.data?.liquidityPositions) {
//           let formattedPositions = await Promise.all(
//             result?.data?.liquidityPositions.map(async positionData => {
//               const returnData = await getReturns(account, positionData.pair, ethPrice)
//               return {
//                 ...positionData,
//                 assetReturn: returnData.asset.return,
//                 assetPercentChange: returnData.asset.percent,
//                 netReturn: returnData.net.return,
//                 netPercentChange: returnData.net.percent,
//                 mooniswapReturn: returnData.mooniswap.return,
//                 mooniswapPercentChange: returnData.mooniswap.percent
//               }
//             })
//           )
//           updatePositions(account, formattedPositions)
//           return formattedPositions
//         }
//       } catch (e) {
//         console.log(e)
//       }
//     }
//     if (!positions && account && ethPrice) {
//       fetchData(account)
//     }
//   }, [account, positions, updatePositions, updateUserHodlReturns, ethPrice])
//
//   return positions
// }

export function useUserPositions(account) {
  const [state, { updatePositions }] = useUserContext()
  const positions = state?.[account]?.[POSITIONS_KEY]

  const snapshots = useUserSnapshots(account)
  const [ethPrice] = useEthPrice()

  useEffect(() => {
    async function fetchData(account) {
      try {
        let result = await client.query({
          query: USER_POSITIONS,
          variables: {
            user: account
          },
          fetchPolicy: 'no-cache'
        })
        if (result?.data?.liquidityPositions) {
          let formattedPositions = await Promise.all(
            result?.data?.liquidityPositions.map(async positionData => {
              const returnData = await getLPReturnsOnPair(account, positionData.pair, ethPrice, snapshots)
              return {
                ...positionData,
                ...returnData
              }
            })
          )
          updatePositions(account, formattedPositions)
        }
      } catch (e) {
        console.log(e)
      }
    }
    if (!positions && account && ethPrice && snapshots) {
      fetchData(account)
    }
  }, [account, positions, updatePositions, ethPrice, snapshots])



  return positions
}



/**
 * For each day starting with min(first position timestamp, beginning of time window),
 * get total liquidity supplied by user in USD. Format in array with date timestamps
 * and usd liquidity value.
 */
export function useUserLiquidityChart(account) {
  // formatted array to return for chart data
  const [formattedHistory, setFormattedHistory] = useState()

  const [startDateTimestamp, setStartDateTimestamp] = useState()
  const [activeWindow] = useTimeframe()

  // monitor the old date fetched
  useEffect(() => {
    let startTime = getTimeframe(activeWindow)
    if ((activeWindow && startTime < startDateTimestamp) || !startDateTimestamp) {
      setStartDateTimestamp(startTime)
    }
  }, [activeWindow, startDateTimestamp])

  // fetch data if we havent yet
  useEffect(() => {
    async function fetchHistory() {
      // set default beginning to beginning of time window
      const utcCurrentTime = dayjs()
      let startTime = startDateTimestamp

      // if first position starts after beginning of timestamps, update startime
      let {
        data: { liquidityPositionSnapshots: results }
      } = await client.query({
        query: FIRST_SNAPSHOT,
        variables: {
          user: account
        }
      })

      // catch case with no history
      if (results?.length === 0) {
        setFormattedHistory([])
        return
      }

      // if first snapshot starts before window, update start of window
      startTime = results[0].timestamp > startTime ? results[0].timestamp : startTime

      // create the array of timestamps for every day in the chart
      const timestamps = []
      while (startTime < utcCurrentTime.unix()) {
        timestamps.push(startTime)
        startTime += 84600
      }

      // for each day, fetch the block number associated with day timestamp (in bulk)
      const blocks = await getBlocksFromTimestamps(timestamps)

      // for each block, get the lp positions and pair data for each
      let { data: dayDatas } = await client.query({
        query: POSITIONS_BY_BLOCK(account, blocks)
      })

      // for each day, map over all positions and sum USD, push value to history
      let newData = []
      for (var row in dayDatas) {
        let currentDay = {}
        let timestamp = row.split('t')[1]
        let valueUSD = 0
        if (timestamp) {
          for (let i = 0; i < dayDatas[row].length; i++) {
            let pairInfo = dayDatas[row][i]
            const pairLiquidityValue =
              (parseFloat(pairInfo.liquidityTokenBalance) / pairInfo.pair.totalSupply) * pairInfo.pair.reserveUSD
            valueUSD += pairLiquidityValue
            currentDay[pairInfo.pair.id] = pairLiquidityValue
          }
          currentDay.date = timestamp
          currentDay.valueUSD = valueUSD
        }
        newData.push(currentDay)
      }

      setFormattedHistory(newData)
    }
    if (!formattedHistory && startDateTimestamp) {
      fetchHistory()
    }
  }, [account, formattedHistory, startDateTimestamp])

  return formattedHistory
}
