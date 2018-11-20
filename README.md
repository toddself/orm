# parthenon
An experimental ORM using JSONB column types in Postgres

## Usage

```js
const joi = require('joi')
const ORM = require('./orm')
const orm = new ORM({database: 'test'})
const UserModel = orm.makeModel({
  name: 'user',
  table: 'users',
  fields: {
    name: joi.string()
  }
})
await orm.initialize([UserModel])
const user = new UserModel({name: 'todd'})
await user.save()
await orm.end()
```

## License
Copyright © 2018 Todd Kennedy, Apache-2.0 licensed
