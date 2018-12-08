# parthenon
An experimental ORM using JSONB column types in Postgres

## Usage

```js
const ORM = require('./orm')
const orm = new ORM({database: 'test'})
const UserModel = orm.makeModel({
  name: 'user',
  table: 'users',
  fields: {
    name: orm.fields.string(),
    group: orm.fields.related('group', 'members')
  }
})
const GroupModel = orm.makeModel({
  name: 'group',
  fields: {
    name: orm.fields.string(),
    user: orm.fields.related(UserModel, 'members')
  }
})
await orm.initialize([UserModel])
const group = new GroupModel({name: 'people'})
const user = new UserModel({name: 'todd', group})
await user.save()
await orm.end()
```

## License
Copyright © 2018 Todd Kennedy, Apache-2.0 licensed
