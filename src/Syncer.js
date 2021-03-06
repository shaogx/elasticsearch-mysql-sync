"use strict"

const elasticsearch = require("elasticsearch")
const mysql = require("mysql")
const cronJob = require('./cronjob')
const SyncJob = cronJob.SyncJob
const EsUtil = require("es_utils")
const _ = require("lodash")
const moment = require("moment")

class Syncer extends EsUtil {
  constructor(config) {
    super(config.elasticsearch, config.index, config.type)
    this.sql = config.sql
    this.connection = mysql.createConnection(config.mysql)
    this.settings = config.settings
    this.mappings = config.mappings
    this.schedule = config.schedule
    this.$lastexecutionstart = config.initialParameter.lastexecutionstart || new Date(0)
    this.$lastexecutionend = config.initialParameter.lastexecutionend || new Date(0)
    this.$lastexecutionstartInSeconds = config.initialParameter.lastexecutionstartInSeconds || 0
    this.$lastexecutionendInSeconds = config.initialParameter.lastexecutionendInSeconds || 0
    this.$totalrows = config.initialParameter.totalrows || 0
  }

  async sync() {
    try {
      const body = {
        settings: this.settings,
        mappings: this.mappings
      }
      try {
        await this.createIndex(body)
      } catch (error) {}

      let results
      for (let i = 0; i < this.sql.length; i++) {
        const statement = this.sql[i].statement
        const parameter = this.sql[i].parameter.map(x => {
          if (x[0] === "$") {
            x = this[x]
          }
          return x
        })
        results = await new Promise((resolve, reject) => {
          const that = this
          this.connection.query(statement, parameter,
            function(error, results, fields) {
              if (error) reject(error)
              resolve(results)
            })
        })
      }

      const docs = results.map(x => {
        const _x = _.cloneDeep(x)
        _x._id = undefined
        return {
          id: x._id,
          doc: _x
        }
      })

      const docsLen = docs.length
      let resp
      let start = 0
      let _docs
      const step = 1000
      while (start < docsLen) {
        const end = start + step
        _docs = docs.slice(start, end)
        resp = await this.bulkIndex(_docs)
        console.log(JSON.stringify(resp, null, 4))
        start = end
      }
      return docsLen
    } catch (error) {
      console.log(error)
    }
  }

  async incrementSync() {
    try {

      const syncJob = new SyncJob(this.schedule)

      syncJob.fireOnTick = async() => {
        try {
          console.log(this.$lastexecutionstartInSeconds);
          const executionstart = new Date()
          const executionstartInSeconds = moment().unix()
          this.$totalrows += await this.sync()
          this.$lastexecutionstart = executionstart
          this.$lastexecutionstartInSeconds = executionstartInSeconds
          this.$lastexecutionend = new Date()
          this.$lastexecutionendInSeconds = moment().unix()
        } catch (error) {
          console.log(error)
        }
      }

      syncJob.start()

    } catch (error) {
      console.log(error)
    }
  }

}

module.exports = Syncer