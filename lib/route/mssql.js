/**
 * SQLServer模型路由注册
 * Created by yinfxs on 16-5-31.
 */

'use strict';

const _ = require('underscore');
const uuid = require('node-uuid');
const mssql = require('../utils/mssql');
const i18n = require('../utils/i18n');
const log = require('../utils/log')(module);

const app = {};

exports = module.exports = app;

/**
 * 获取表对象的主键数组
 * @param table
 * @returns {Array}
 */
function primaryKeys(table) {
    const keys = [];
    if (!table || !table.columns || table.columns.length == 0) return keys;
    table.columns.map(function (column) {
        if (!column || column.primary != true) return;
        keys.push(column.name);
    });
    return keys;
}

/**
 * 默认查找对象
 * @param table
 * @param keyword
 * @returns {Array}
 */
function defaultFindCondition(table, schema, keyword) {
    const conditions = [], fields = schema.fields;//默认查所有
    if (!table || !table.columns || table.columns.length == 0) return conditions;
    _.keys(fields).forEach(function (key) {
        if (fields[key].ctrltype && fields[key].ctrltype != 'string')return;
        conditions.push(`[${table.name}].[${key}] like '%${keyword}%'`);
    });
    return conditions;
}
/**
 * 设置主键默认值
 * @param table
 */
function defaultPrimaryKey(table) {
    if (!table || !table.rows || table.rows.length == 0) return;
    const keys = primaryKeys(table);
    table.rows.forEach(function (row) {
        keys.forEach(function (key) {
            if (row[key]) return;
            row[key] = uuid.v1();
        })
    });
}

/**
 * 生成sort部分
 * @param table
 * @param sort
 */
function sortPart(table, sort) {
    const result = {positive: [], reverse: []};
    if (!sort) return result;
    sort.split(' ').forEach(function (item) {
        if (!item) return;
        const positive = item.startsWith('-') ? `[${table.name}].[${item.substring(1, item.length)}] DESC` : `[${table.name}].[${item}]`;
        const reverse = item.startsWith('-') ? `[${table.name}].[${item.substring(1, item.length)}]` : `[${table.name}].[${item}] DESC`;
        result.positive.push(positive);
        result.reverse.push(reverse);
    });
    return result;
}
/**
 * 生成join部分
 * @param table
 * @param schema
 */
function joinPart(table, schema) {
    const joins = [], fields = schema.fields;
    _.keys(schema.fields).forEach(function (code) {
        const field = fields[code];
        if (!field.ref || !field.refOptions) return;
        const key = field.ref;
        const refOptions = field.refOptions;
        const splitIndex = key.indexOf('-');
        const moduleCode = key.substring(0, splitIndex);
        const modelCode = key.substring(splitIndex + 1);
        const alias = moduleCode + '_' + modelCode + '_' + code;
        joins.push(`LEFT JOIN ${moduleCode}_${modelCode} AS [${alias}] ON [${alias}].[${refOptions.value}] = [${table.name}].[${code}]`);
    });
    return joins;
}
/**
 * 生成查询列部分
 * @param table
 * @param keys
 * @param schema
 * @returns {Array}
 */
function columnsPart(table, keys, schema) {
    const columns = [], fields = schema.fields;
    _.keys(schema.fields).forEach(function (code) {
        const field = fields[code];
        if (field.ref) {
            const key = field.ref;
            const refOptions = field.refOptions;
            const splitIndex = key.indexOf('-');
            const moduleCode = key.substring(0, splitIndex);
            const modelCode = key.substring(splitIndex + 1);
            switch (field.ctrltype) {
                case 'ref':
                    const alias = moduleCode + '_' + modelCode + '_' + code;
                    columns.push(`[${alias}].[${refOptions.value}] AS [${code}.${refOptions.value}]`);
                    columns.push(`[${alias}].[${refOptions.display}] AS [${code}.${refOptions.display}]`);
                    break;
                case 'refs':

                    break;
            }
        } else {
            columns.push(`[${table.name}].[${code}]`);
        }
    });
    keys.forEach(function (code) {
        columns.push(`[${table.name}].[${code}]`);
    });
    return columns;
}

/**
 * 新增操作
 * @param object 查询信息
 * @param req 请求对象
 * @param res 响应对象
 */
app.create = function (object, req, res) {
    const table = object.table;
    const modelCode = object.modelCode;
    table.rows = [];
    if (_.isArray(req.body)) {
        table.rows = req.body;
    } else if (_.isObject(req.body)) {
        table.rows = [req.body];
    }
    defaultPrimaryKey(table);
    mssql.bulk(table, function (rowCount) {
        return res.json({rowCount: rowCount});
    }, function (err) {
        log.error(i18n.value('log_create_object_error', [modelCode, JSON.stringify(err)]));
        return res.json({err: {message: i18n.value('res_create_object_error'), detail: err}});
    });
};

/**
 * 删除操作
 * @param object 查询信息
 * @param req 请求对象
 * @param res 响应对象
 */
app.delete = function (object, req, res) {
    const table = object.table;
    const modelCode = object.modelCode;
    const conditions = _.keys(req.body).map(function (key) {
        return `[${key}]='${req.body[key]}'`;
    });
    mssql.transaction(`DELETE FROM ${table.name} WHERE ${conditions.join(' and ')}`, function (rs) {
        return res.json(_.isObject(rs) ? rs : {result: rs});
    }, function () {
        log.error(i18n.value('log_delete_object_error', [modelCode, JSON.stringify(err)]));
        return res.json({err: {message: i18n.value('res_delete_object_error'), detail: err}});
    });
};

/**
 * 更新操作
 * @param object 查询信息
 * @param req 请求对象
 * @param res 响应对象
 */
app.update = function (object, req, res) {
    const table = object.table;
    const modelCode = object.modelCode;
    const cond = req.body.cond || {};
    const doc = req.body.doc || {};
    const conditions = _.keys(cond).map(function (key) {
        return `[${key}]='${cond[key]}'`;
    });
    const pairs = _.keys(doc).map(function (key) {
        return `[${key}]='${doc[key]}'`;
    });
    const command = `UPDATE ${table.name} SET ${pairs.join(',')} WHERE ${conditions.join(' and ')}`;
    mssql.transaction(command, function () {
        return res.json(doc);
    }, function () {
        log.error(i18n.value('log_update_object_error', [modelCode, JSON.stringify(err)]));
        return res.json({err: {message: i18n.value('res_update_object_error'), detail: err}});
    });
};
/**
 * 列表查询
 * @param object 查询信息
 * @param req 请求对象
 * @param res 响应对象
 */
app.list = function (object, req, res) {
    const table = object.table;
    const modelCode = object.modelCode;
    const schema = object.schema;
    const keyword = req.query.keyword || '';
    const conditions = keyword ? defaultFindCondition(table, schema, keyword) : ['1=1'];
    const flag = parseInt(req.query.flag) || 0;
    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 20;
    const keys = primaryKeys(table);
    const key = keys[0];//分页时子查询只查询主键，速度快
    const columns = columnsPart(table, keys, schema);
    const sort = sortPart(table, req.query.sort);
    const joins = joinPart(table, schema);
    if (sort.positive.length == 0) {
        //默认主键排序
        sort.positive = [`[${table.name}].[${key}]`];
        sort.reverse = [`[${table.name}].[${key}] DESC`];
    }
    let command = null;
    if (flag != 1) {
        //分页
        command = `SELECT ${columns.join(',')} FROM ${table.name} ${joins.join(' ')} WHERE [${table.name}].[${key}] IN (SELECT TOP ${size} ${key} FROM (SELECT TOP ${page * size} ${key} FROM ${table.name} WHERE ${conditions.join(' or ')} ORDER BY ${sort.positive.join(',')}) w ORDER BY ${sort.reverse.join(',')}) ORDER BY ${sort.positive.join(',')}`;
    } else {
        //全部查询
        command = `SELECT ${columns.join(',')} FROM ${table.name} ${joins.join(' ')} WHERE ${conditions.join(' or ')} ORDER BY ${sort.positive.join(',')}`;
    }
    mssql.query(command, function (result) {
        mssql.query(`SELECT COUNT(${key}) AS counts FROM ${table.name} WHERE ${conditions.join(' or ')}`, function (rs) {
            const count = rs.counts;
            let data = {
                data: result,
                totalelements: count,
                flag: flag,
                sort: req.query.sort,
                keyword: keyword,
                start: 1,
                end: count
            };
            if (flag != 1) {
                data.page = page;
                data.size = size;
                data.totalpages = Math.ceil(count / size);
                data.start = page > data.totalpages ? 0 : ((page - 1) * size + 1);
                data.end = page > data.totalpages ? 0 : (data.start + size - 1);
                data.end = data.end > data.totalelements ? data.totalelements : data.end;
            }
            return res.json(data);
        }, function (err) {
            log.error(i18n.value('log_read_object_error', [modelCode, JSON.stringify(err)]));
            return res.json({err: {message: i18n.value('res_read_object_error'), detail: err}});
        });
    }, function (err) {
        log.error(i18n.value('log_read_object_error', [modelCode, JSON.stringify(err)]));
        return res.json({err: {message: i18n.value('res_read_object_error'), detail: err}});
    });
};

/**
 * 通过ID查询到那个对象
 * @param object 查询信息
 * @param req 请求对象
 * @param res 响应对象
 * @returns {*}
 */
app.one = function (object, req, res) {
    const id = req.params.id;
    if (!id) return res.json({error: i18n.value('query_param_error'), detail: i18n.value('not_specified_id')});
    const table = object.table;
    const modelCode = object.modelCode;
    const schema = object.schema;
    const keys = primaryKeys(table);
    const columns = columnsPart(table, keys, schema);
    const joins = joinPart(table, schema);
    const conditions = _.keys(keys).map(function (i) {
        return `[${table.name}].[${keys[i]}]='${id}'`;
    });
    const command = `SELECT ${columns.join(',')} FROM ${table.name} ${joins.join(' ')} WHERE ${conditions.join(' and ')}`;
    mssql.query(command, function (rs) {
        rs = rs && rs.length > 0 ? rs[0] : rs;
        return res.json(rs);
    }, function (err) {
        log.error(i18n.value('log_read_object_error', [modelCode, JSON.stringify(err)]));
        return res.json({err: {message: i18n.value('res_read_object_error'), detail: err}});
    });
};